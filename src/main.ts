import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as github from '@actions/github'
import stripAnsi from 'strip-ansi'

function format(output: string): string {
  const ret = ['**The container image has inefficient files.**']
  let summarySection = false
  let inefficientFilesSection = false
  let resultSection = false

  for (const line of output.split('\n')) {
    if (line.includes('Analyzing image')) {
      summarySection = true
      inefficientFilesSection = false
      resultSection = false
      ret.push('### Summary')
    } else if (line.includes('Inefficient Files:')) {
      summarySection = false
      inefficientFilesSection = true
      resultSection = false
      ret.push('### Inefficient Files')
    } else if (line.includes('Results:')) {
      summarySection = false
      inefficientFilesSection = false
      resultSection = true
      ret.push('### Results')
    } else if (summarySection || resultSection) {
      ret.push(stripAnsi(line))
    } else if (inefficientFilesSection) {
      if (line.startsWith('Count')) {
        ret.push('| Count | Wasted Space | File Path |')
        ret.push('|---|---|---|')
      } else {
        // https://github.com/wagoodman/dive/blob/master/runtime/ci/evaluator.go#L140
        ret.push(
          `| ${line.slice(0, 5)} | ${line.slice(7, 19)} | ${line.slice(21)} |`
        )
      }
    }
  }
  return ret.join('\n')
}

async function run(): Promise<void> {
  try {
    const engine = core.getInput('engine')
    const image = core.getInput('image')
    const minEfficiency = core.getInput('min-image-efficiency')
    const maxWastedRatio = core.getInput('max-wasted-ratio')
    const maxWastedBytes = core.getInput('max-wasted-bytes')
    const diveVersion = core.getInput('dive-version')
    const diveImage = `wagoodman/dive:${diveVersion}`

    await exec.exec('docker', ['pull', diveImage])

    const commandOptions = [
      '-e',
      'DOCKER_API_VERSION=1.37',
      '--rm',
      '-v',
      '/var/run/docker.sock:/var/run/docker.sock'
    ]

    const parameters = [
      'run',
      ...commandOptions,
      diveImage,
      image,
      '--ci',
      '--source',
      engine
    ]

    if (minEfficiency) {
      parameters.push('--lowestEfficiency', minEfficiency)
    }

    if (maxWastedRatio) {
      parameters.push('--highestUserWastedPercent', maxWastedRatio)
    }

    if (maxWastedBytes) {
      parameters.push('--highestWastedBytes', maxWastedBytes)
    }

    let output = ''
    const execOptions = {
      ignoreReturnCode: true,
      listeners: {
        stdout: (data: Buffer) => {
          output += data.toString()
        },
        stderr: (data: Buffer) => {
          output += data.toString()
        }
      }
    }

    const exitCode = await exec.exec('docker', parameters, execOptions)
    if (exitCode === 0) {
      // success
      return
    }

    const token = core.getInput('github-token')
    if (!token) {
      return
    }

    const octokit = github.getOctokit(token)
    const comment = {
      ...github.context.issue,
      issue_number: github.context.issue.number,
      body: format(output)
    }

    await octokit.issues.createComment(comment)
    core.setFailed(`Scan failed (exit code: ${exitCode})`)
  } catch (error) {
    core.setFailed(`Unhandled Error: ${error}`)
  }
}

run()
