module.exports = {
  globals: {
    "ts-jest": {
      tsConfig: "tsconfig.jest.json"
    }
  },
  moduleFileExtensions: ["js", "ts", "tsx"],
  moduleNameMapper: {
    "@cfg": "<rootDir>/config/configForJest.ts",
    "@src/(.*)": "<rootDir>/src/$1",
    "@test/(.*)": "<rootDir>/test/$1"
  },
  setupTestFrameworkScriptFile: "<rootDir>/test/helpers/index.ts",
  testMatch: ["**/*.test.(ts|tsx|js)"],
  transform: {
    "^.+\\.(ts|tsx)$": "ts-jest",
    "^.+\\.(css|less|sass|scss|png|jpg|ttf|woff|woff2)$": "jest-transform-stub"
  },
  preset: "ts-jest"
};
