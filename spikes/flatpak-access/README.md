# Flatpak file-access check (throwaway)

Test plan, section 8: does the Flatpak sandbox allow open, atomic save and file watch?
This program does what the Marky backend will do. It is not a Tauri app, because the
question is about the sandbox, and the Tauri backend uses the same `std::fs` and `notify` calls.

    flatpak-builder --user --install --force-clean build nl.marky.FlatpakAccess.yml
    cargo build --release
    ./run.sh
