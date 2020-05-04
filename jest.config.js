module.exports = {
  moduleFileExtensions: ["js", "ts", "tsx"],
  moduleNameMapper: {
    "@cfg": "<rootDir>/config/configForJest.ts",
    "@src/(.*)": "<rootDir>/src/$1",
    "@test/(.*)": "<rootDir>/test/$1",
  },
  setupFilesAfterEnv: ["<rootDir>/test/helpers/index.ts"],
  testMatch: ["**/src/**/*.test.(ts|tsx|js)", "**/src/test/*.test.(ts|tsx|js)"],
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
  transform: {
    "^.+\\.(j|t)sx?$": "babel-jest",
    "^.+\\.(css|less|sass|scss|pcss|png|jpg|ttf|woff|woff2)$":
      "jest-transform-stub",
  },
};
