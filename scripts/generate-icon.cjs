// Render the code-native SVG with Electron, then wrap the PNG in an ICO file.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({
      width: 256,
      height: 256,
      useContentSize: true,
      show: false,
      transparent: true,
      frame: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    const svg = fs.readFileSync(
      path.join(__dirname, "../assets/icon.svg"),
      "utf8",
    );
    await win.loadURL(
      "data:text/html;charset=utf-8," +
        encodeURIComponent(
          "<style>html,body{margin:0;width:256px;height:256px;overflow:hidden}</style>" +
            svg,
        ),
    );
    const source =
      "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
    const data = await win.webContents.executeJavaScript(`(async () => {
    const img = new Image(); img.src = ${JSON.stringify(source)}; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    canvas.getContext('2d').drawImage(img, 0, 0, 256, 256); return canvas.toDataURL('image/png');
  })()`);
    const png = Buffer.from(data.split(",")[1], "base64");
    fs.writeFileSync(path.join(__dirname, "../assets/icon.png"), png);
    const header = Buffer.alloc(22);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);
    header.writeUInt16LE(1, 10);
    header.writeUInt16LE(32, 12);
    header.writeUInt32LE(png.length, 14);
    header.writeUInt32LE(22, 18);
    fs.writeFileSync(
      path.join(__dirname, "../assets/icon.ico"),
      Buffer.concat([header, png]),
    );
    win.destroy();
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
