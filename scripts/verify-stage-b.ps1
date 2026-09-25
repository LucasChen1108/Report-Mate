param(
    [string]$TestDatabaseUrl = $env:STAGE_B_TEST_DATABASE_URL
)

$ErrorActionPreference = "Stop"
$repositoryRoot = Split-Path -Parent $PSScriptRoot
$previousAuthMode = $env:VITE_AUTH_MODE
$previousTestDatabaseUrl = $env:STAGE_B_TEST_DATABASE_URL

try {
    if (-not [string]::IsNullOrWhiteSpace($TestDatabaseUrl)) {
        $env:STAGE_B_TEST_DATABASE_URL = $TestDatabaseUrl
    }

    Push-Location (Join-Path $repositoryRoot "backend")
    try {
        go test ./...
        go vet ./...

        if (-not [string]::IsNullOrWhiteSpace($TestDatabaseUrl)) {
            go test ./cmd/server -run TestStageBPostgresHTTPJourneys -count=1 -v
        }
    }
    finally {
        Pop-Location
    }

    Push-Location (Join-Path $repositoryRoot "frontend")
    try {
        npm test
        $env:VITE_AUTH_MODE = "api"
        npm run build
    }
    finally {
        Pop-Location
    }
}
finally {
    $env:VITE_AUTH_MODE = $previousAuthMode
    $env:STAGE_B_TEST_DATABASE_URL = $previousTestDatabaseUrl
}
