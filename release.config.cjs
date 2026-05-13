const prereleaseBranches = [
  'feature/*',
  'feat/*',
  'fix/*',
  'chore/*',
  'hotfix/*',
]

const branchName = process.env.GITHUB_REF_NAME || ''
const isMainRelease = branchName === 'main'

/** @type {import('semantic-release').GlobalConfig} */
module.exports = {
  branches: [
    {
      name: 'main',
      channel: false,
    },
    ...prereleaseBranches.map((name) => ({
      name,
      channel: 'pre',
      prerelease: '${name.replace(/[^0-9A-Za-z-]/g, '-')}',
    })),
  ],
  plugins: [
    '@semantic-release/commit-analyzer',
    '@semantic-release/release-notes-generator',
    [
      '@semantic-release/changelog',
      {
        changelogFile: 'CHANGELOG.md',
      },
    ],
    [
      '@semantic-release/npm',
      {
        npmPublish: false,
      },
    ],
    ...(isMainRelease
      ? [
          [
            '@semantic-release/git',
            {
              assets: ['package.json', 'package-lock.json', 'CHANGELOG.md'],
              message:
                'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
            },
          ],
        ]
      : []),
    '@semantic-release/github',
  ],
}