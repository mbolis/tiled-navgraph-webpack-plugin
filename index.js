"use strict";

const GlobSync = require("glob").GlobSync;
const path = require("path");

const VirtualModulesPlugin = require("webpack-virtual-modules");

const tmx = require("tmx-parser");
const util = require("util");
const readMap = util.promisify(tmx.parseFile);

const CollisionContainer = require("./collision");
const { Rect } = CollisionContainer;

const cross = (ns) => ns.flatMap((n1, i) => ns.slice(i + 1).map((n2) => [n1, n2]));

class MapMatcher {
  constructor(cwd, src) {
    const g = new GlobSync(src, { cwd });
    this._matcher = g.minimatch;
    this.found = g.found;
  }

  matches(path) {
    return this._matcher.match(path);
  }
}

class TiledNavgraph {
  constructor(cwd, srcs, layers, padding) {
    this._cwd = cwd;
    this._layers = layers;
    this._padding = padding;

    this._matchers = [];
    this.found = [];
    for (let src of srcs) {
      const m = new MapMatcher(path.resolve(cwd), src);
      this._matchers.push(m);
      for (let found of m.found) {
        this.found.push(found);
      }
    }
    this.found.sort();
  }

  _findIndex(path) {
    let i = 0;
    let j = this.found.length - 1;

    while (i <= j) {
      const mi = (i + j) >>> 1;
      const mv = this.found[mi];
      if (mv === path) return mi;
      if (mv < path) i = mi + 1;
      else j = mi - 1;
    }

    return ~i;
  }

  match(path) {
    return this._matchers.find((m) => m.matches(path));
  }

  offer(path) {
    const i = this._findIndex(path);
    if (i >= 0) return;

    const match = this.match(path);
    if (!match) return;

    this.found.splice(~i, 0, path);
    this._dirty = true;
    return match;
  }

  remove(path) {
    const i = this._findIndex(path);
    if (i < 0) return;

    this._dirty = true;
    return this.found.splice(i, 1)[0];
  }

  _dirty = true;

  async $source() {
    if (!this._dirty) return (this._source = this._source + " ");
    console.log("Rebuilding navigation graph");
    console.time("nav graph");

    let rects;
    if (this._padding) {
      const pad = this._padding;
      const dPad = pad * 2;

      rects = (bounds) => ({ x, y, width, height }) => [
        new Rect(x - pad, y - pad, width + dPad, height + dPad).intersect(bounds),
        // new Rect(x - pad, y + pad, width + dPad, height - dPad).intersect(bounds),
        // new Rect(x + pad, y - pad, width - dPad, height + dPad).intersect(bounds),
      ];
    } else {
      rects = () => ({ x, y, width, height }) => [new Rect(x, y, width, height)];
    }

    const navGraph = {};

    for (let src of this.found) {
      const map = await readMap(path.resolve(this._cwd, src));
      const bounds = new Rect(0, 0, map.width * map.tileWidth, map.height * map.tileHeight);

      const obstacles = map.layers
        .filter((l) => l.type === "object" && this._layers.test(l.name))
        .flatMap((l) => l.objects)
        .filter((o) => !o.ellipse && !o.polygon && !o.polyline)
        .map(({ x, y, width, height }) => ({ x, y, width, height }));

      const collision = new CollisionContainer(obstacles);
      const nodes = obstacles.flatMap(rects(bounds)).flatMap((o) => o.points);
      const edges = cross(nodes)
        .filter(([n1, n2]) => n1.distance(n2) < 800)
        .filter((e) => collision.hasFreeLOS(e, this._padding))
        .map(([n1, n2]) => [n1, n2, n1.distance(n2)]);

      let name = path.basename(src, path.extname(src));
      navGraph[name] = { obstacles, nodes, edges };
    }

    console.timeEnd("nav graph");

    this._dirty = false;
    return (this._source = JSON.stringify(navGraph));
  }

  get source() {
    return this.$source();
  }
}

module.exports = class TiledNavgraphPlugin extends (
  VirtualModulesPlugin
) {
  constructor({ path, src = ["**/*.tmx"], cwd = ".", layers = /.*/, padding = 0 }) {
    if (!/\.json$/.test(path)) throw new Error("Only JSON path supported by TiledNavgraph plugin.");
    super();

    this._path = path;
    this._src = typeof src === "string" ? [src] : src;
    this._cwd = cwd;
    this._layers = layers;
    this._padding = padding;
  }

  apply(compiler) {
    super.apply(compiler);

    compiler.hooks.watchRun.tap("TiledNavgraphPlugin.watch", () => this._startWatching());
    compiler.hooks.beforeCompile.tapPromise("TiledNavgraphPlugin", () => this._buildGraph());
  }

  _startWatching() {
    if (this._watching) return;
    this._watching = {};
  }

  async _buildGraph() {
    if (this._ready) return;

    const graph = new TiledNavgraph(this._cwd, this._src, this._layers, this._padding);
    super.writeModule(this._path, await graph.source);

    if (this._watching) {
      const chokidar = require("chokidar");

      const cwd = this._cwd;
      const baseDirs = graph.found
        .map((f) => path.relative(".", f).split(path.sep)[0])
        .reduce((baseDirs, dir) => {
          if (!baseDirs.includes(dir)) baseDirs.push(dir);
          return baseDirs;
        }, []);

      chokidar
        .watch(baseDirs, { cwd })
        .on("change", async (resource) => graph.match(resource) && super.writeModule(this._path, await graph.source));
      chokidar
        .watch(baseDirs, { cwd })
        .on("add", async (resource) => graph.offer(resource) && super.writeModule(this._path, await graph.source));
      chokidar
        .watch(baseDirs, { cwd })
        .on("unlink", async (resource) => graph.remove(resource) && super.writeModule(this._path, await graph.source));
    }

    this._ready = true;
  }
};
