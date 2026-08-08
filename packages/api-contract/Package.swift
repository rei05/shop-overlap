// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "ShopOverlapAPI",
    platforms: [.iOS(.v17)],
    products: [
        .library(name: "ShopOverlapAPI", targets: ["ShopOverlapAPI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/apple/swift-openapi-generator", exact: "1.11.1"),
        .package(url: "https://github.com/apple/swift-openapi-runtime", exact: "1.12.0"),
        .package(url: "https://github.com/apple/swift-openapi-urlsession", exact: "1.3.0"),
    ],
    targets: [
        .target(
            name: "ShopOverlapAPI",
            dependencies: [
                .product(name: "OpenAPIRuntime", package: "swift-openapi-runtime"),
                .product(name: "OpenAPIURLSession", package: "swift-openapi-urlsession"),
            ],
            plugins: [
                .plugin(name: "OpenAPIGenerator", package: "swift-openapi-generator"),
            ]
        ),
    ]
)
