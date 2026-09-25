# Caro

A web-app editor for authoring UI layout specifications. In Caro, UI elements are
represented as boxes with vertical and horizontal resizing policies. Resize
policies are shown using a color-coded system, with the edges of boxes
color-encoded based on the policy in that direction. Using this system, UI layouts
can be visually represented in a way that is independent of any specific layout
system and without requiring deep knowledge of such systems.

## Building

    npm install
    npm run build
    npm start

`npm start` serves the app on `http://localhost:8080`, rebuilding as the
source changes. It must be served over localhost or https: the File System
Access API is unavailable on `file://`, and is only implemented by Chrome and
Edge. Both it and `npm run build` write `application/bundle.js`, so that
folder always holds the build that is running rather than whichever one was
last made by hand.

## Testing

    npm test

Suites ending in `_test` run against the compiled source in node. The rest
drive the app in a browser, so they need the development server and a browser
listening for the debugging protocol:

    npm start
    msedge --headless --remote-debugging-port=9222 about:blank

`converted` walks the specifications in `specs` beside this repository, or
wherever `CARO_SPECS` points, and reports itself skipped when they are not
there, the drawings being taken out of that folder once converted. A single
suite runs on its own with `node tests/<suite>.js`.

## Format

    Board
      name: string
      components: Component[]        outermost first
        name: string                 'Element:Name' or 'Name'
        layouts: Layout[]            ascending priority
          condition: string          empty for the default
          properties: string         free text, may be empty
          boxes: Box[]
          overlays: Box[][]          ascending layer order

A `Box` carries a `name`, naming another component in the board and empty
when the box is only space; an `x` and `y` in pixels from the layout's top
left; a `width` and `height` in pixels as drawn; a `widthPolicy` and
`heightPolicy` of `fixed`, `fill`, `fit` or `repeat`; and an optional
`repeatDirection`.

A `fixed` size is a literal value taken from the visual, a `fill` size takes
the available space and shares it equally between siblings, and a `fit` size
is determined by the contents. The terms and their meanings come from
https://wiki.spiretrading.com/index.php/Layout; the colours come from
`xd_parser`, which decodes the drawings themselves: yellow `fixed`, blue
`fill`, green `fit`, purple `repeat`.

Layouts replace one another wholesale when their condition is met; they do
not inherit. This differs from component scenarios, which accumulate.

`specifications.md` describes the format in full -- how a scenario is chosen,
what a policy means, what is repeated and what a file caro calls valid holds
-- for reading a specification without opening the editor.
