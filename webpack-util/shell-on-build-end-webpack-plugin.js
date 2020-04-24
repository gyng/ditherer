/* eslint-disable @typescript-eslint/explicit-function-return-type */

const { spawn } = require("child_process");

/**
 * @typedef {Object} Options
 * @property {string} command - The command to run
 * @property {boolean=} once - Whether to run the script only once
 * @property {boolean=} killExisting - Whether to kill existing running
 *                                     commands before running again
 * @property {boolean=} debug
 */

/**
 * @param options {Options}
 * @property {boolean} ran
 * @property {import("child_process").ChildProcess} child
 */
module.exports = function ShellOnBuildEndPlugin(options) {
  this.ran = false;
  this.child = null;

  const debug = (message) => {
    if (options.debug) {
      process.stdout.write(`ℹ ShellOnBuildPlugin: ${message}\n`);
    }
  };

  const killUnwantedExistingChild = () => {
    if (options.killExisting && this.child && !this.child.killed) {
      this.child.kill("SIGTERM");
      debug(`killed ${this.child.pid} ${this.child.killed}\n`);
    }
  };

  this.apply = (compiler) => {
    compiler.hooks.afterEmit.tap("AfterEmitPlugin", () => {
      if (!this.ran) {
        killUnwantedExistingChild();

        this.child = spawn(options.command, {
          stdio: "inherit",
          shell: true,
        });

        this.child.on("close", () => {
          killUnwantedExistingChild();
        });

        debug(`[${this.child.pid}] ${options.command}`);

        if (options.once) {
          this.ran = true;
        }
      }
    });

    compiler.hooks.beforeRun.tap("BeforeRunPlugin", () => {
      killUnwantedExistingChild();
    });
  };
};
