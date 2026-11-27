# Dev preview

The editor in a browser, without Tauri. For visual checks while the app shell does not exist.

    npm run dev
    # http://127.0.0.1:5173/dev/preview.html            sample document
    # http://127.0.0.1:5173/dev/preview.html?diff       with the diff that a save writes
    # http://127.0.0.1:5173/dev/preview.html?file=tables.md   a file from tests/corpus
    # http://127.0.0.1:5173/dev/preview.html?theme=dark  a forced theme (light or dark)
    # http://127.0.0.1:5173/dev/settings.html?os=linux   the settings window

## Screenshots and recording (Playwright WebKit)

Playwright WebKit does not run on Arch (it needs Ubuntu libraries), so it runs in the Playwright container.
Start `npm run dev` first.

    mkdir -p /tmp/marky-capture
    docker run --rm --network host --user $(id -u):$(id -g) -e HOME=/tmp \
      -v $PWD:/work:ro -v /tmp/marky-capture:/out -w /work \
      mcr.microsoft.com/playwright:v1.65.1-noble node dev/capture.mjs
