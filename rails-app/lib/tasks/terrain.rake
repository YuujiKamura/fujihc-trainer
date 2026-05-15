# lib/tasks/terrain.rake
#
# GLB terrain + course のビルド task。
# 中身は script/build_terrain_glb.mjs の thin wrapper。
#
# 使い方:
#   bin/rake terrain:build     # GLB を build (= public/models/fuji_course.glb)
#   bin/rake terrain:verify    # 生成された GLB の妥当性 assert
#   bin/rake terrain:rebuild   # build → verify を順に実行
#
# Build 時の依存 (= three.js / pngjs) は rails-app/script/package.json 経由。
# 初回のみ:
#   cd script && npm install

namespace :terrain do
  RAILS_APP_ROOT = File.expand_path("..", __dir__).then { |p| File.expand_path("..", p) }
  SCRIPT_DIR = File.join(RAILS_APP_ROOT, "script")
  BUILD_SCRIPT = File.join(SCRIPT_DIR, "build_terrain_glb.mjs")
  VERIFY_SCRIPT = File.join(SCRIPT_DIR, "verify_glb.mjs")
  NODE_MODULES = File.join(SCRIPT_DIR, "node_modules")

  desc "Build fuji_course.glb (= terrain + course + start/goal/rider anchors)"
  task :build do
    unless File.directory?(NODE_MODULES)
      abort "[terrain:build] script/node_modules/ not found. " \
            "Run `cd #{SCRIPT_DIR} && npm install` first."
    end
    puts "[terrain:build] node #{BUILD_SCRIPT}"
    Dir.chdir(SCRIPT_DIR) do
      ok = system("node", BUILD_SCRIPT)
      abort "[terrain:build] FAILED" unless ok
    end
  end

  desc "Verify public/models/fuji_course.glb structure"
  task :verify do
    unless File.directory?(NODE_MODULES)
      abort "[terrain:verify] script/node_modules/ not found. " \
            "Run `cd #{SCRIPT_DIR} && npm install` first."
    end
    puts "[terrain:verify] node #{VERIFY_SCRIPT}"
    Dir.chdir(SCRIPT_DIR) do
      ok = system("node", VERIFY_SCRIPT)
      abort "[terrain:verify] FAILED" unless ok
    end
  end

  desc "Rebuild fuji_course.glb and verify it"
  task rebuild: %i[build verify]
end
