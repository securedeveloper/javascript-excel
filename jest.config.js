module.exports = {
    "globals": {
        "ts-jest": {
            "skipBabel": true
        }
    },
    "collectCoverage": true,
    "coverageDirectory": "./coverage/",
    "collectCoverageFrom": [
        "**/*.{ts,tsx}",
        "!**/.circleci/**",
        "!**/.idea/**",
        "!**/lib/**",
        "!**/node_modules/**",
    ],
    "transform": {
        "^.+\\.(ts|tsx)$": "ts-jest"
    },
    "testRegex": ".*/test/(.*/)?.*.test.(ts|tsx)",
    "moduleFileExtensions": [
        "ts",
        "tsx",
        "js"
    ],
    "moduleDirectories": [
        "node_modules"
    ],
    modulePathIgnorePatterns: [
        "<rootDir>/.circleci",
        "<rootDir>/.idea",
        "<rootDir>/coverage",
        "<rootDir>/lib",
        "<rootDir>/node_modules",
        "<rootDir>/.gitignore",
        "<rootDir>/.npmrc",
        "<rootDir>/README.md",
        "<rootDir>/tsconfig.json"
    ]
}
