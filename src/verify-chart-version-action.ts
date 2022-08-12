import * as core from "@actions/core";
import * as github from "@actions/github";
import { ResponseHeaders } from "@octokit/types";
import * as fs from "fs-extra";
import * as semver from "semver";
import * as YAML from "yaml";

async function run() {
  try {
    if (github.context.eventName !== "pull_request") {
      core.setFailed("This action can only run on pull requests!");
      return;
    }

    const githubToken = core.getInput("token");
    const chart = core.getInput("chart", { required: true });
    const base = core.getInput("base", { required: false });
    const chartYamlPath = `${chart}/Chart.yaml`;

    const defaultBranch = github.context.payload.repository?.default_branch;
    const octokit = github.getOctokit(githubToken);

    if (!(await fs.pathExists(chartYamlPath))) {
      core.setFailed(`${chart} is not a valid Helm chart folder!`);
      return;
    }

    if (base) {
      try {
        await octokit.rest.git.getRef({
          owner: github.context.repo.owner,
          repo: github.context.repo.repo,
          ref: base,
        });
      } catch (error) {
        core.setFailed(`Ref ${base} was not found for this repository!`);
        return;
      }
    }

    let originalChartYamlFile:
      | {
          data: any;
          headers?: ResponseHeaders;
          status?: 200;
          url?: string;
        }
      | undefined;
    let originalChartVersion: string | semver.SemVer | undefined;

    try {
      originalChartYamlFile = await octokit.rest.repos.getContent({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        path: `${chartYamlPath}`,
        ref: base || `heads/${defaultBranch}`,
      });
    } catch (error) {
      core.warning(
        `Could not find original Chart.yaml for ${chart}, assuming this is a new chart.`
      );
    }

    if (originalChartYamlFile && "content" in originalChartYamlFile.data) {
      const originalChartYamlContent = Buffer.from(
        String(originalChartYamlFile.data.content),
        "base64"
      ).toString("utf-8");
      const originalChartYaml = await YAML.parse(originalChartYamlContent);
      originalChartVersion = originalChartYaml.version;
    }

    const updatedChartYamlContent = await fs.readFile(chartYamlPath, "utf8");
    const updatedChartYaml = await YAML.parse(updatedChartYamlContent);
    if (!updatedChartYaml.version) {
      core.setFailed(`${chartYamlPath} does not contain a version!`);
      return;
    }
    const updatedChartVersion: string | semver.SemVer =
      updatedChartYaml.version;
    if (!semver.valid(updatedChartVersion)) {
      core.setFailed(`${updatedChartVersion} is not a valid SemVer version!`);
      return;
    }

    if (originalChartVersion) {
      if (updatedChartVersion === originalChartVersion) {
        core.setFailed(`Chart version has not been updated!`);
        return;
      }

      if (!semver.gt(updatedChartVersion, originalChartVersion)) {
        core.setFailed(
          `Updated chart version ${updatedChartVersion} is < ${originalChartVersion}!`
        );
        return;
      }

      core.info(`Old chart version: ${originalChartVersion}`);
    }

    core.info(`New chart version: ${updatedChartVersion}`);

    core.info(`New chart version verified succesfully.`);
  } catch (error) {
    core.setFailed(String(error));
  }
}

async function runWrapper() {
  try {
    await run();
  } catch (error) {
    core.setFailed(`verify-chart-version action failed: ${error}`);
    console.log(error);
  }
}

void runWrapper();
