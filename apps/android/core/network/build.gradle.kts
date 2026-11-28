plugins {
    alias(libs.plugins.kotlin.jvm)
}

// Conexion con el anfitrion por WebSocket (Ktor): saludo cifrado, lectura de mensajes y envio. Sin Android, para KMP.
kotlin {
    jvmToolchain(17)
}

dependencies {
    api(project(":core:protocol"))
    api(libs.ktor.client.core)
    implementation(libs.ktor.client.websockets)
    api(libs.kotlinx.coroutines.core)

    testImplementation(kotlin("test"))
    testImplementation(testFixtures(project(":core:protocol")))
    testImplementation(libs.ktor.client.cio)
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform()
    testLogging {
        events("passed", "failed", "skipped")
        showStandardStreams = true
    }
}
