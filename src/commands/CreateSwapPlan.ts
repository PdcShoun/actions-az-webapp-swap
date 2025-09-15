import * as core from '@actions/core';
import { DefaultArtifactClient } from '@actions/artifact/lib/internal/client';
import fs from 'fs';
import path from 'path';
import { createBranchWhenNotExist, createPullRequest, gitCommit, gitCommitNewBranch } from '../utils/githubUtiltiy';
import { constants } from '../constants';
import { executeProcess } from '../utils/executeProcess';
import { PathUtility } from '../utils/PathUtility';
const { WorkingDirectory, DefaultEncoding, gitConfig } = constants;

interface ICreateSwapPlanOption {
  repo: string;
  ref: string;
  token: string;
  path: string;
}

export class CreateSwapPlan {
  constructor(private options: ICreateSwapPlanOption) {}

  public async execute() {
    core.debug(`Using create-swap-plan mode`);
    const { repo, path: targetPath, ref, token: personalAccessToken } = this.options;
    const artifactClient = new DefaultArtifactClient();
    const listArtifactsResponse = await artifactClient.listArtifacts();
    const sharedGitConfig = {
      repo,
      ref,
      personalAccessToken,
      name: gitConfig.name,
      email: gitConfig.email,
    };

    await createBranchWhenNotExist(sharedGitConfig);

    /**
     * Step 2: Commit Marked App Setting (Source Slot)
     */
    const pathUtility = new PathUtility(WorkingDirectory.root);

    await executeProcess('tree', { slient: false });

    // output result
    for (const artifactItem of listArtifactsResponse.artifacts) {
      const downloadArtifactResponse = await artifactClient.downloadArtifact(artifactItem.id);
      if (downloadArtifactResponse.downloadPath) {
        console.log(artifactItem.name);
        console.log(downloadArtifactResponse.downloadPath);
        await executeProcess(
          `cp -rf ${path.join(
            downloadArtifactResponse.downloadPath,
            WorkingDirectory.root,
            WorkingDirectory.beforeSwap
          )} ${WorkingDirectory.root}`
        );
      } else {
        core.warning(`Artifact ${artifactItem.name} did not have a download path.`);
      }
    }

    await gitCommit({
      ...sharedGitConfig,
      targetPath,
      rootPath: WorkingDirectory.root,
      message: 'Get App Setting',
    });
    pathUtility.clean();

    /**
     * Step 3: Simulate if values are swapped (Target Slot)
     */

    for (const artifactItem of listArtifactsResponse.artifacts) {
      const downloadArtifactResponse = await artifactClient.downloadArtifact(artifactItem.id);
      if (downloadArtifactResponse.downloadPath) {
        console.log(artifactItem.name);
        console.log(downloadArtifactResponse.downloadPath);
        await executeProcess(
          `cp -rf ${path.join(
            downloadArtifactResponse.downloadPath,
            WorkingDirectory.root,
            WorkingDirectory.afterSwap
          )} ${WorkingDirectory.root}`
        );
      } else {
        core.warning(`Artifact ${artifactItem.name} did not have a download path.`);
      }
    }

    // Create tmp file if no change it will be merge
    fs.writeFileSync(
      path.resolve(WorkingDirectory.root, `timestamp-${new Date().getTime()}`),
      'Force Diff for Preview Change',
      DefaultEncoding
    );

    const newBranch = await gitCommitNewBranch({
      ...sharedGitConfig,
      targetPath,
      rootPath: WorkingDirectory.root,
      message: 'Get App Setting if app service is swapped',
    });

    await createPullRequest({
      ...sharedGitConfig,
      sourceBranch: newBranch,
    });
  }
}
