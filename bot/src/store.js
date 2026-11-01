"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { TrackerModel } = require("./model");

class Store extends TrackerModel {
  constructor(file, options = {}) {
    const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : undefined;
    super({ ...options, data });
    this.file = file;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const temporary = this.file + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }
}

module.exports = { Store };
