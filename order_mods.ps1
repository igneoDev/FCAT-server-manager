$path = "server.json"
$data = Get-Content $path -Raw | ConvertFrom-Json

$idx = 0
$data.game.mods =
    $data.game.mods |
    Select-Object @{n='orig';e={$idx++}}, * |
    Sort-Object @{e={
        switch -Regex ($_.name) {
            '^ACE\b'  { 0 }
            '^RHS\b'  { 1 }
            '^GRS\b'  { 4 }
            '^Tactical Flava\b' { 5 }
            '^FCAT\b' { 6 }
            default   { 3 }
        }
    }}, orig |
    Select-Object -ExcludeProperty orig

# Verifique a ordem (opcional)
$data.game.mods.name

# Grave de volta
$data | ConvertTo-Json -Depth 6 | Set-Content $path