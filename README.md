# tiled-navgraph-webpack-plugin
A Webpack plugin to automatically generate navigation graphs for Tiled maps

## Usage
Install package from NPM repository:
```bash
npm i -D tiled-navgraph-webpack-plugin
```

Include in `webpack.config.js` and configure as follows:
```js
// ./webpack.config.js

const TiledNavgraphPlugin = require("tiled-navgraph-webpack-plugin");

module.exports = {
  // ...
  plugins: [
    // ...
    new TiledNavgraphPlugin({
      path: "./src/navigation.json",
      cwd: "./public",
      src: "data/**/*.tmx",
      layers: /collision/,
      padding: 32
    })
  ]
};
```

The resources file will be added as a virtual module (not written to disk) and accessible at the position specified with the `path` option.

**Note** that `path`'s extension must be `.json`.

Files will be searched following the [glob](https://www.npmjs.com/package/glob#glob-primer) expression provided as `src`, starting from `cwd` (default: `"."`).

Object layers matching the `layers` regular expression will be scanned for *rectangular* obstacles.

An optional `padding` can be specified to ensure the generated graph takes into consideration navigating entities size.  
*Note* that at the moment a very simple padding calculation is used, so calculations are sped up and graph size is kept small. (TODO: sophisticated obstacle padding)

Using the previous example configuration, you can import the navigation graph into your game like this:

```js
// ./src/game.js

import navigationGraph from "./navigation.json";
```

After the above import, `navigationGraph` will contain an object with the following structure, that you can use to implement pathfinding:

```js
{
  obstacles: [
    {
      x: Number,
      y: Number,
      width: Number,
      height: Number
    }
  ],
  nodes: [
    {
      x: Number,
      y: Number
    }
  ],
  edges: [
    [
      {
        x: Number,
        y: Number
      },
      {
        x: Number,
        y: Number
      },
      Number // precalculated euclidean distance between the two points
    ]
  ]
}
```

*Note* that
* the graph is not directed
* edges between two nodes are listed only once
