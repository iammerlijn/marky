# Marky icon

Source files of the app icon. The files in `src-tauri/icons/` are made from these files.

| File | Use |
| --- | --- |
| `marky-macos.svg` | Master icon on the macOS 1024 grid (squircle with margin and shadow). Source of all sizes from 64 px up. |
| `marky.svg` | Linux icon. The Flatpak installs it as the scalable icon `io.github.iammerlijn.Marky.svg`. |
| `marky-32.svg` | Pixel-fitted icon for 32 px. |
| `marky-16.svg` | Pixel-fitted icon for 16 px. |

## Make the sizes again

Use `rsvg-convert` (librsvg): it renders the shadow filter correctly.

```sh
# 1. Render the master and make all sizes.
rsvg-convert -w 1024 -h 1024 packaging/icon/marky-macos.svg -o /tmp/marky-1024.png
npx tauri icon /tmp/marky-1024.png
rm -rf src-tauri/icons/android src-tauri/icons/ios src-tauri/icons/64x64.png  # not used

# 2. Render the pixel-fitted sizes.
rsvg-convert -w 16 -h 16 packaging/icon/marky-16.svg -o /tmp/marky-16.png
rsvg-convert -w 32 -h 32 packaging/icon/marky-32.svg -o /tmp/marky-32.png
cp /tmp/marky-32.png src-tauri/icons/32x32.png

# 3. Put the pixel-fitted sizes in icon.icns.
iconutil -c iconset src-tauri/icons/icon.icns -o /tmp/marky.iconset
cp /tmp/marky-16.png /tmp/marky.iconset/icon_16x16.png
cp /tmp/marky-32.png /tmp/marky.iconset/icon_16x16@2x.png
cp /tmp/marky-32.png /tmp/marky.iconset/icon_32x32.png
iconutil -c icns /tmp/marky.iconset -o src-tauri/icons/icon.icns
```

4. Put the pixel-fitted sizes in `icon.ico`: replace the 16 px and 32 px entries with
   `/tmp/marky-16.png` and `/tmp/marky-32.png`. Keep the other entries (24, 48, 64 and 256 px)
   from `npx tauri icon`. Keep all entries as PNG, so that the file stays small.
