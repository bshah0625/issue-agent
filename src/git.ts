import { simpleGit } from 'simple-git'
import { existsSync } from 'node:fs'

export async function cloneOrPull(repoUrl: string, localPath: string): Promise<void> {
  if (existsSync(localPath)) {
    const git = simpleGit(localPath)
    await git.pull()
  } else {
    const git = simpleGit()
    await git.clone(repoUrl, localPath)
  }
}

export async function createAndCheckoutBranch(
  localPath: string,
  branchName: string
): Promise<void> {
  try {
    const git = simpleGit(localPath)
    await git.checkoutLocalBranch(branchName)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to create branch '${branchName}': ${message}`)
  }
}

export async function stageAll(localPath: string): Promise<void> {
  const git = simpleGit(localPath)
  await git.add('-A')
}

export async function commit(localPath: string, message: string): Promise<void> {
  try {
    const git = simpleGit(localPath)
    await git.commit(message)
  } catch (err) {
    const message_ = err instanceof Error ? err.message : String(err)
    throw new Error(`Commit failed: ${message_}`)
  }
}

export async function push(localPath: string, branchName: string): Promise<void> {
  const git = simpleGit(localPath)
  await git.push('origin', branchName, ['--set-upstream'])
}

export async function getHeadSha(localPath: string): Promise<string> {
  const git = simpleGit(localPath)
  return git.revparse(['HEAD'])
}
