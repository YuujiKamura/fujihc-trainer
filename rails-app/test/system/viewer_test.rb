require "application_system_test_case"

class ViewerTest < ApplicationSystemTestCase
  test "root path renders canvas element in DOM" do
    visit root_path
    # GLB load の成否は scope 外。 canvas element が DOM に出ていれば合格。
    assert_selector "div[data-controller='viewer-3d']"
    assert_selector "canvas[data-viewer-3d-target='canvas']", visible: :all
  end
end
