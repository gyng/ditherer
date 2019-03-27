const { exec } = require("child_process");

/**
 * @typedef {Object} Options
 * @property {string} command - The command to run
 * @property {boolean=} once - Whether to run the script only once
 * @param options {Options}
 */
module.exports = function ShellOnBuildEndPlugin(options) {
  this.run = false;

  this.apply = compiler => {
    compiler.hooks.afterEmit.tap("AfterEmitPlugin", () => {
      if (!this.ran) {
        exec(options.command, (err, stdout, stderr) => {
          if (stdout) process.stdout.write(stdout);
          if (stderr) process.stderr.write(stderr);
        });

        if (options.once) {
          this.ran = true;
        }
      }
    });
  };
};
