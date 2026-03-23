const os = require('os');
if (!os.availableParallelism) {
  os.availableParallelism = () => {
    try {
      return os.cpus().length;
    } catch (e) {
      return 1;
    }
  };
}
