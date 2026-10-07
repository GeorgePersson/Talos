const fs = require("node:fs/promises");
const path = require("node:path");

module.exports = async ({ electronPlatformName, appOutDir }) => {
  if (electronPlatformName !== "linux") return;
  // Source checkouts on Windows do not preserve Unix executable mode bits.
  await fs.chmod(path.join(appOutDir, "install.sh"), 0o755);
};
