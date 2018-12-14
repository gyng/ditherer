const { exec } = require("child_process");

let ran = false;

/**
 * @typedef {Object} Options
 * @property {string} command - The command to run
 * @property {boolean=} once - Whether to run the script only once
 * @param options {Options}
 */
module.exports = function ShellOnBuildEndPlugin(options) {
  this.apply = compiler => {
    compiler.hooks.afterEmit.tap("AfterEmitPlugin", () => {
      if (!ran) {
        exec(options.command, (err, stdout, stderr) => {
          if (stdout) process.stdout.write(stdout);
          if (stderr) process.stderr.write(stderr);
        });

        if (options.once) {
          ran = true;
        }
      }
    });
  };
};
