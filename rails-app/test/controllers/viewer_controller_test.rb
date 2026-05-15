require "test_helper"

class ViewerControllerTest < ActionDispatch::IntegrationTest
  test "GET / returns 200 and renders viewer canvas" do
    get root_url
    assert_response :success
    assert_select "div[data-controller=?]", "viewer-3d"
    assert_select "canvas[data-viewer-3d-target=?]", "canvas"
  end
end
