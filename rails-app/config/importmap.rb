# Pin npm packages by running ./bin/importmap

pin "application"
pin "@hotwired/stimulus", to: "stimulus.min.js"
pin "@hotwired/stimulus-loading", to: "stimulus-loading.js"
pin_all_from "app/javascript/controllers", under: "controllers"
pin "three", to: "three.js" # @0.160.0 (vendored from unpkg)
pin "three/addons/loaders/GLTFLoader.js", to: "three-gltf-loader.js" # @0.160.0
pin "three/addons/controls/OrbitControls.js", to: "three-orbit-controls.js" # @0.160.0
pin "three/addons/utils/BufferGeometryUtils.js", to: "three-buffer-geometry-utils.js" # @0.160.0
