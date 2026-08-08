import XCTest

final class ShopOverlapUITests: XCTestCase {
    func testOpensSearchOptions() {
        let app = XCUIApplication()
        app.launch()

        app.buttons["search-options-button"].tap()

        XCTAssertTrue(app.textFields["place-field"].waitForExistence(timeout: 2))
        XCTAssertTrue(app.buttons["search-button"].exists)
    }
}
