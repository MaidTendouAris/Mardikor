// SVG is the only drawing source. Reuse the project's Electron/Chromium renderer.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
if (!process.versions.electron) {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawnSync(require("electron"), [__filename], {
    cwd: root,
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  if (child.error) console.error(child.error);
  process.exit(child.status ?? 1);
}

const { app, BrowserWindow, nativeImage } = require("electron");
const sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256, 512, 1024];
const icons = [
  { name: "app", label: "Mardikor", source: "assets/icon.svg" },
  {
    name: "mdk-default",
    label: "MDK · default",
    source: "assets/icons/mdk-default.svg",
  },
  {
    name: "mdk-book",
    label: "MDK · book",
    source: "assets/icons/mdk-book.svg",
  },
  {
    name: "mdk-comic",
    label: "MDK · comic",
    source: "assets/icons/mdk-comic.svg",
  },
  { name: "markdown", label: "Markdown", source: "assets/icons/markdown.svg" },
];
const output = path.join(root, "assets/icons");
app.setPath("userData", path.join(root, ".test-artifacts/icon-renderer"));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("force-device-scale-factor", "1");

function write(relative, data) {
  const file = path.join(output, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}

// ICO supports PNG frames on the Windows versions supported by Electron.
function ico(frames) {
  const selected = [...frames].filter(([size]) => size <= 256);
  const header = Buffer.alloc(6 + 16 * selected.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(selected.length, 4);
  let offset = header.length;
  selected.forEach(([size, png], index) => {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...selected.map(([, png]) => png)]);
}

function icns(frames) {
  const types = [
    ["icp4", 16],
    ["icp5", 32],
    ["icp6", 64],
    ["ic07", 128],
    ["ic08", 256],
    ["ic09", 512],
    ["ic10", 1024],
    ["ic11", 32],
    ["ic12", 64],
    ["ic13", 256],
    ["ic14", 512],
  ];
  const chunks = types.map(([type, size]) => {
    const png = frames.get(size);
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, "ascii");
    header.writeUInt32BE(8 + png.length, 4);
    return Buffer.concat([header, png]);
  });
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(
    8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0),
    4,
  );
  return Buffer.concat([header, ...chunks]);
}

// Executed in a sandboxed, hidden Chromium window. Each size is rendered from SVG.
async function rasterize(svg, requestedSizes) {
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await image.decode();
  return requestedSizes.map((size) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    canvas.getContext("2d").drawImage(image, 0, 0, size, size);
    return [size, canvas.toDataURL("image/png").split(",")[1]];
  });
}

function previewHtml() {
  const columns = icons
    .map((icon) => {
      const src = icon.name === "app" ? "../icon.svg" : `${icon.name}.svg`;
      return `<article><div class="hero"><img src="${src}" width="112" height="112"></div>
      <h2>${icon.label}</h2><p>${icon.name === "app" ? "APPLICATION" : icon.name === "markdown" ? ".md" : ".mdk"}</p>
      <div class="sizes">${[16, 24, 32, 48].map((size) => `<div><img src="png/${icon.name}/${size}.png" width="${size}" height="${size}"><small>${size}</small></div>`).join("")}</div></article>`;
    })
    .join("");
  const dark = icons
    .map(
      (icon) =>
        `<div><img src="png/${icon.name}/64.png" width="64" height="64"><span>${icon.label}</span></div>`,
    )
    .join("");
  return `<!doctype html><html lang="en"><meta charset="UTF-8"><title>Mardikor icons</title>
    <style>*{box-sizing:border-box}body{margin:0;padding:40px;background:#f3f6fb;color:#18253c;font:14px "Segoe UI",sans-serif}
    header{display:flex;justify-content:space-between;align-items:end;margin-bottom:28px}h1{font-size:26px;letter-spacing:-.6px;margin:0}header p{margin:0;color:#64748b}
    main{display:grid;grid-template-columns:repeat(5,1fr);gap:16px}article{background:white;border:1px solid #e2e8f0;border-radius:16px;text-align:center;padding:28px 12px 20px}
    .hero{height:132px;display:grid;place-items:center}h2{font-size:15px;margin:14px 0 6px}article p{color:#64748b;font-size:11px;letter-spacing:1px;margin:0}
    .sizes{border-top:1px solid #edf1f7;display:flex;justify-content:center;align-items:end;gap:12px;margin-top:24px;padding-top:22px}.sizes div{display:flex;align-items:center;flex-direction:column;gap:10px}small{font-size:10px;color:#64748b}
    .dark{background:#172033;border-radius:16px;margin-top:24px;padding:24px;display:grid;grid-template-columns:repeat(5,1fr);color:#cbd5e1}.dark div{display:flex;flex-direction:column;align-items:center;gap:12px}.dark span{font-size:12px}
    footer{color:#64748b;font-size:12px;margin-top:20px}img{display:block}</style>
    <header><h1>Mardikor / Icons</h1><p>One family. Five simple marks.</p></header><main>${columns}</main><section class="dark">${dark}</section>
    <footer>SVG sources · Transparent PNG 16–1024 px · Windows ICO · macOS ICNS</footer></html>`;
}

app
  .whenReady()
  .then(async () => {
    const window = new BrowserWindow({
      show: false,
      width: 1200,
      height: 700,
      useContentSize: true,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    try {
      await window.loadURL("data:text/html,<meta charset=utf-8>");
      for (const icon of icons) {
        const source = fs.readFileSync(path.join(root, icon.source), "utf8");
        const raster = await window.webContents.executeJavaScript(
          `(${rasterize.toString()})(${JSON.stringify(source)}, ${JSON.stringify(sizes)})`,
        );
        const frames = new Map(
          raster.map(([size, data]) => [size, Buffer.from(data, "base64")]),
        );
        for (const [size, png] of frames) {
          const decoded = nativeImage.createFromBuffer(png).getSize();
          if (decoded.width !== size || decoded.height !== size)
            throw new Error(`Invalid PNG: ${icon.name}/${size}`);
          write(`png/${icon.name}/${size}.png`, png);
        }
        write(`${icon.name}.ico`, ico(frames));
        write(`${icon.name}.icns`, icns(frames));
        if (icon.name === "app") {
          fs.writeFileSync(path.join(root, "assets/icon.png"), frames.get(512));
          fs.writeFileSync(path.join(root, "assets/icon.ico"), ico(frames));
          fs.writeFileSync(path.join(root, "assets/icon.icns"), icns(frames));
        }
        console.log(`${icon.name}: ${sizes.length} PNG sizes, ICO, ICNS`);
      }
      write("preview.html", previewHtml());
      await window.loadFile(path.join(output, "preview.html"));
      await window.webContents.executeJavaScript(
        "Promise.all([...document.images].map(image => image.decode()))",
      );
      const preview = await window.webContents.capturePage(undefined, {
        stayHidden: true,
        stayAwake: true,
      });
      write("preview.png", preview.toPNG());
      console.log("Preview: assets/icons/preview.html and preview.png");
    } finally {
      window.destroy();
    }
  })
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
