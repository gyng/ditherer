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
 * This webpack plugin runs a command whenever a webpack build finishes.
 * Optionally, have it only run once, or kill previous in-flight runs before rerunning.
 *
 * @param options {Options}
 * @property {boolean} ranOnce - whether the command has been marked as run,
 *                               and prevents subsequent runs if options.once is set
 * @property {import("child_process").ChildProcess} child - the spawned child process
 */
module.exports = function ShellOnBuildEndPlugin(options) {
  this.ranOnce = false;
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
      const onceEnabledAndNotRun = options.once && !this.ranOnce;
      const onceDisabled = !options.once;

      if (onceEnabledAndNotRun || onceDisabled) {
        killUnwantedExistingChild();

        this.child = spawn(
          options.command || "echo no command passed to ShellOnBuildEndPlugin",
          {
            shell: true,
          }
        );

        // child process has ended, we force kill it to mark it as killed
        this.child.on("close", () => {
          killUnwantedExistingChild();
        });

        debug(`[${this.child.pid}] ${options.command}`);

        this.ranOnce = true;
      }
    });

    // terminate child process as early as possible to make your computer lag less
    compiler.hooks.beforeRun.tap("BeforeRunPlugin", () => {
      killUnwantedExistingChild();
    });
  };
};
