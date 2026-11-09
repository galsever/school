plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

android {
    namespace = "com.galsever.school"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.galsever.school"
        minSdk = 26
        targetSdk = 36
        // CI sets these from the run number
        versionCode = (System.getenv("SC_VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("SC_VERSION_NAME") ?: "dev"
        buildConfigField("String", "ORIGIN", "\"https://school.galsever.com\"")
    }

    signingConfigs {
        create("release") {
            // GitHub Actions secrets (keystore kept out of the repo); local release builds stay unsigned
            System.getenv("SC_KEYSTORE")?.let {
                storeFile = file(it)
                storePassword = System.getenv("SC_KEYSTORE_PASSWORD")
                keyAlias = "school"
                keyPassword = System.getenv("SC_KEYSTORE_PASSWORD")
            }
        }
    }

    buildTypes {
        // Both talk to school.galsever.com through the Pocket ID gate: the hub holds the real school accounts,
        // so there is no ungated dev host. The debug build replaces the release build on a device.
        release {
            if (System.getenv("SC_KEYSTORE") != null) signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin { jvmToolchain(17) }

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2025.06.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.navigation:navigation-compose:2.9.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.1")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.1")
    implementation("androidx.core:core-ktx:1.16.0")
    implementation("androidx.browser:browser:1.8.0")
    implementation("androidx.work:work-runtime-ktx:2.10.1")

    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("io.coil-kt.coil3:coil-compose:3.2.0")
    implementation("io.coil-kt.coil3:coil-network-okhttp:3.2.0")
    // untrusted HTML of messages, mail and Moodle: cleaned before it is shown
    implementation("org.jsoup:jsoup:1.18.3")
    // camera pages -> cropped, straightened PDF (Google Play services document scanner)
    implementation("com.google.android.gms:play-services-mlkit-document-scanner:16.0.0")
}
