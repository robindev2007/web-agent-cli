import type { Config } from "jest";

const config: Config = {
  testEnvironment: "node",
  transform: {
    "^.+\\.(t|j)sx?$": "@swc/jest",
  },
  testMatch: ["**/tests/**/*.e2e.test.ts"],
  testTimeout: 30000,
  verbose: true,
};

export default config;

