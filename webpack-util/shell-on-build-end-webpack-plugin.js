const { exec } = require("child_process");

module.exports = function ShellOnBuildEndPlugin(script) {
  this.apply = compiler => {
    compiler.hooks.afterEmit.tap("AfterEmitPlugin", () => {
      exec(script, (err, stdout, stderr) => {
        if (stdout) process.stdout.write(stdout);
        if (stderr) process.stderr.write(stderr);
      });
    });
  };
};
