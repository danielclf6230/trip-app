$ErrorActionPreference = "Stop"

$signingRoot = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "TripApp-signing\android"
$keystorePath = Join-Path $signingRoot "trip-tools-release.jks"
$credentialPath = Join-Path $signingRoot "trip-tools-signing.credential.xml"

if (-not (Test-Path -LiteralPath $keystorePath)) {
    throw "Android release keystore was not found at $keystorePath"
}

if (-not (Test-Path -LiteralPath $credentialPath)) {
    throw "Encrypted Android signing credential was not found at $credentialPath"
}

$credential = Import-Clixml -LiteralPath $credentialPath
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($credential.Password)

try {
    $signingPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $env:TRIP_TOOLS_ANDROID_KEYSTORE = $keystorePath
    $env:TRIP_TOOLS_ANDROID_KEYSTORE_PASSWORD = $signingPassword
    $env:TRIP_TOOLS_ANDROID_KEY_ALIAS = $credential.UserName
    $env:TRIP_TOOLS_ANDROID_KEY_PASSWORD = $signingPassword
    $env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
    $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA "Android\Sdk"
    $env:NDK_HOME = Join-Path $env:ANDROID_HOME "ndk\30.0.16248370"

    & npx tauri android build --apk --target aarch64 --ci
    if ($LASTEXITCODE -ne 0) {
        throw "Android release build failed with exit code $LASTEXITCODE"
    }
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    Remove-Item Env:\TRIP_TOOLS_ANDROID_KEYSTORE -ErrorAction SilentlyContinue
    Remove-Item Env:\TRIP_TOOLS_ANDROID_KEYSTORE_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:\TRIP_TOOLS_ANDROID_KEY_ALIAS -ErrorAction SilentlyContinue
    Remove-Item Env:\TRIP_TOOLS_ANDROID_KEY_PASSWORD -ErrorAction SilentlyContinue
}
