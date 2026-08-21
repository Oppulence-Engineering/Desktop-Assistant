package main

deny contains message if {
  input.name == "x"
  required := {"lint", "architecture", "ast-grep", "semgrep", "knip", "packages:check", "security:electron"}
  missing := required - {name | input.scripts[name]}
  count(missing) > 0
  message := sprintf("root package.json is missing gauntlet scripts: %v", [missing])
}

deny contains message if {
  input.name == "x"
  not contains(input.scripts.verify, "architecture:baseline")
  message := "verify must enforce the architecture debt ratchet"
}

deny contains message if {
  input.name == "@x/core"
  not input.exports["./*"]
  message := "@x/core must expose declared package subpaths instead of dist/ escape hatches"
}

deny contains message if {
  input.name == "@x/shared"
  not input.exports["./*"]
  message := "@x/shared must expose declared package subpaths instead of dist/ escape hatches"
}

deny contains message if {
  input.name == "oppulence"
  not input.devDependencies["@electron-forge/plugin-fuses"]
  message := "the Electron package must apply its fuse policy during Forge packaging"
}
