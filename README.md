# Ookayama Point Cloud Viewer

大岡山キャンパス周辺を 2026-11-08 に走行したロボットの LiDAR 地図（FAST-LIO）に、カメラ画像から色を付けた点群のブラウザ用ビューアです。
6,000 万点（2 cm 格子の 1.02 億サーフェルから間引き）を八分木で段階的に読み込みます。

- 回転: ドラッグ / 平行移動: 右ドラッグ / ズーム: ホイール / ダブルクリックで注視点を設定
- Fly モード: WASD で移動、Q/E で上下、Shift で高速
- スマホ: 1 本指で回転、2 本指で移動・ズーム

A browser viewer for a coloured LiDAR map of the Ookayama area (robot run, 2026-11-08): 60 M points, progressive octree LOD, orbit / fly / touch controls.
Built with [three.js](https://threejs.org/) (MIT, see vendor/LICENSE).
