import XCTest

final class ShopOverlapUITests: XCTestCase {
    func testKeepsSearchActionVisibleWithOptionsInitiallyCollapsed() {
        let app = XCUIApplication()
        app.launch()

        let map = app.otherElements["results-map"]
        XCTAssertTrue(map.waitForExistence(timeout: 2))
        XCTAssertFalse(map.frame.isEmpty)
        XCTAssertTrue(app.frame.intersects(map.frame))
        let mapLocationButton = app.buttons["map-current-location-button"]
        XCTAssertTrue(mapLocationButton.exists)
        XCTAssertTrue(mapLocationButton.isHittable)

        let placeField = app.textFields["place-field"]
        XCTAssertTrue(placeField.waitForExistence(timeout: 2))
        let searchButton = app.buttons["search-button"]
        XCTAssertTrue(searchButton.exists)
        XCTAssertTrue(searchButton.isHittable)
        XCTAssertTrue(searchButton.isEnabled)

        let radiusSlider = app.sliders["search-radius-slider"]
        XCTAssertFalse(radiusSlider.exists)

        let optionsDisclosure = app.descendants(matching: .any)["search-options-disclosure"]
        XCTAssertTrue(optionsDisclosure.exists)
        optionsDisclosure.tap()
        XCTAssertTrue(radiusSlider.waitForExistence(timeout: 2))
        XCTAssertEqual(radiusSlider.value as? String, "20 km")

        let searchContent = app.scrollViews["search-content-scroll"]
        XCTAssertTrue(searchContent.exists)
        XCTAssertTrue(searchContent.isHittable)
        for _ in 0 ..< 3 where placeField.isHittable {
            searchContent.swipeUp()
        }
        XCTAssertFalse(placeField.isHittable)
        XCTAssertTrue(radiusSlider.isHittable)
        XCTAssertTrue(map.exists)
        XCTAssertFalse(map.frame.isEmpty)
        XCTAssertTrue(app.frame.intersects(map.frame))
        XCTAssertTrue(mapLocationButton.isHittable)
        XCTAssertTrue(searchButton.exists)
        XCTAssertTrue(searchButton.isHittable)
    }

    func testExplainsWhySearchIsDisabled() {
        let app = XCUIApplication()
        app.launch()

        let removeButton = app.buttons["remove-chain-starbucks"]
        XCTAssertTrue(removeButton.waitForExistence(timeout: 2))
        removeButton.tap()

        XCTAssertTrue(app.staticTexts["search-requirements-message"].exists)
        XCTAssertFalse(app.buttons["search-button"].isEnabled)
    }

    func testRequiresSelectingAPlaceAfterEditingTheQuery() {
        let app = XCUIApplication()
        app.launch()

        let placeField = app.textFields["place-field"]
        XCTAssertTrue(placeField.waitForExistence(timeout: 2))
        placeField.tap()
        placeField.typeText("新")

        XCTAssertTrue(app.staticTexts["search-requirements-message"].waitForExistence(timeout: 2))
        XCTAssertFalse(app.buttons["search-button"].isEnabled)
        XCTAssertTrue(app.buttons["search-button"].isHittable)
    }
}
