/// v0.6a Conformance tests for @route block parsing and BuildTarget emission gates.
///
/// Covers:
///   v0.6.1 — @route block parser + RouteBlock struct in AihuSource
///   v0.6.2 — EmitResult.route_json sidecar
///   v0.6.4 — BuildTarget enum plumbed through CompileUnit
///   v0.6.6 — Client build elides @agent manifest_json + emits warning comment
///   C500   — @route block outside pages/ path → compile error
use aihu_compiler::{compile_full, compile_full_with_target, emit, sfc, BuildTarget};

// ─── v0.6.1 — @route block parsing ──────────────────────────────────────────

/// Basic @route block with all fields is parsed into RouteBlock.
#[test]
fn v061_route_block_parsed_all_fields() {
    let src = r#"
@route {
  path: '/admin/users',
  name: 'admin-users',
  middleware: ['auth', 'admin'],
  ssr: true,
  layout: 'admin'
}

@template {
  <div>Hello</div>
}
"#;
    let parsed = sfc::parse_with_path(src, Some("src/pages/admin/users.aihu")).unwrap();
    let route = parsed.route.as_ref().expect("route should be Some");
    assert_eq!(route.path.as_deref(), Some("/admin/users"));
    assert_eq!(route.name.as_deref(), Some("admin-users"));
    assert_eq!(route.middleware, vec!["auth", "admin"]);
    assert_eq!(route.ssr, Some(true));
    assert_eq!(route.layout.as_deref(), Some("admin"));
}

/// Minimal @route block with only a name field.
#[test]
fn v061_route_block_minimal_name_only() {
    let src = r#"
@route {
  name: 'home'
}

@template {
  <div>Home</div>
}
"#;
    let parsed = sfc::parse_with_path(src, Some("src/pages/index.aihu")).unwrap();
    let route = parsed.route.as_ref().expect("route should be Some");
    assert_eq!(route.name.as_deref(), Some("home"));
    assert!(route.path.is_none());
    assert!(route.middleware.is_empty());
    assert!(route.ssr.is_none());
    assert!(route.layout.is_none());
}

/// @route block with ssr: false
#[test]
fn v061_route_block_ssr_false() {
    let src = r#"
@route {
  name: 'static-page',
  ssr: false
}

@template {
  <div>Static</div>
}
"#;
    let parsed = sfc::parse_with_path(src, Some("src/pages/static.aihu")).unwrap();
    let route = parsed.route.as_ref().expect("route should be Some");
    assert_eq!(route.ssr, Some(false));
}

/// @route block with empty middleware array.
#[test]
fn v061_route_block_empty_middleware() {
    let src = r#"
@route {
  name: 'open-page',
  middleware: []
}

@template {
  <div>Open</div>
}
"#;
    let parsed = sfc::parse_with_path(src, Some("src/pages/open.aihu")).unwrap();
    let route = parsed.route.as_ref().expect("route should be Some");
    assert!(route.middleware.is_empty());
}

/// AihuSource.route is None when no @route block present.
#[test]
fn v061_route_absent_when_no_route_block() {
    let src = r#"
@template {
  <div>Hello</div>
}
"#;
    let parsed = sfc::parse(src).unwrap();
    assert!(parsed.route.is_none());
}

// ─── C500 — @route outside pages/ path ───────────────────────────────────────

/// @route block outside pages/ path → C500 compile error.
#[test]
fn v061_c500_route_outside_pages_path() {
    let src = r#"
@route {
  name: 'widget'
}

@template {
  <div>Widget</div>
}
"#;
    let err = sfc::parse_with_path(src, Some("src/components/widget.aihu")).unwrap_err();
    assert_eq!(err.code.as_deref(), Some("C500"));
    assert!(err.message.contains("C500"));
}

/// @route block with no file path (None) → C500.
#[test]
fn v061_c500_route_no_file_path() {
    let src = r#"
@route {
  name: 'widget'
}

@template {
  <div>Widget</div>
}
"#;
    let err = sfc::parse_with_path(src, None).unwrap_err();
    assert_eq!(err.code.as_deref(), Some("C500"));
}

/// parse() (no file path) does NOT trigger C500 for files without @route.
#[test]
fn v061_no_c500_without_route_block() {
    let src = r#"
@template {
  <div>Hello</div>
}
"#;
    let parsed = sfc::parse(src).unwrap();
    assert!(parsed.route.is_none());
}

// ─── @layout shorthand ────────────────────────────────────────────────────────

/// @layout 'name' shorthand emits a RouteBlock with layout field set.
#[test]
fn v061_layout_shorthand_parses_to_route_block() {
    let src = "@layout 'dashboard'\n\n@template {\n  <div>Page</div>\n}\n";
    let parsed = sfc::parse_with_path(src, Some("src/pages/settings.aihu")).unwrap();
    let route = parsed
        .route
        .as_ref()
        .expect("route should be Some from @layout");
    assert_eq!(route.layout.as_deref(), Some("dashboard"));
    assert!(route.name.is_none());
    assert!(route.path.is_none());
}

/// @layout outside pages/ → C500.
#[test]
fn v061_layout_shorthand_c500_outside_pages() {
    let src = "@layout 'admin'\n\n@template {\n  <div>X</div>\n}\n";
    let err = sfc::parse_with_path(src, Some("src/components/header.aihu")).unwrap_err();
    assert_eq!(err.code.as_deref(), Some("C500"));
}

// ─── v0.6.2 — route_json sidecar ─────────────────────────────────────────────

/// EmitResult.route_json is Some when @route block is present.
#[test]
fn v062_route_json_emitted_when_route_present() {
    let src = r#"
@route {
  path: '/admin/users',
  name: 'admin-users',
  middleware: ['auth'],
  ssr: true,
  layout: 'admin'
}

@template {
  <div>Users</div>
}
"#;
    let parsed = sfc::parse_with_path(src, Some("src/pages/admin/users.aihu")).unwrap();
    let unit = compile_full(&parsed).unwrap();
    let result = emit(&unit, "admin-users");

    let route_json = result
        .route_json
        .as_ref()
        .expect("route_json should be Some");
    assert!(route_json.contains(r#""pattern": "/admin/users""#));
    assert!(route_json.contains(r#""name": "admin-users""#));
    assert!(route_json.contains(r#""auth""#));
    assert!(route_json.contains(r#""ssr": true"#));
    assert!(route_json.contains(r#""layout": "admin""#));
}

/// route_json lists the page's component tags for route-scoped registration:
/// custom-element (hyphenated) and PascalCase references, from nested elements
/// and inside `if`/`each` control flow. Plain HTML tags and framework intrinsics are
/// excluded. O1a (tag naming): the manifest carries NORMALIZED tags —
/// `<UserCard>` is listed as `user-card`, matching reference emission and the
/// define-name.
#[test]
fn route_json_components_lists_referenced_component_tags() {
    let src = r#"
@route { path: '/x', name: 'x-page' }
@template {
  <div>
    <UserCard comment={a} />
    <my-widget></my-widget>
    <p>plain</p>
    <lazy-graph if={cond}></lazy-graph>
  </div>
}
"#;
    let parsed = sfc::parse_with_path(src, Some("src/pages/x.aihu")).unwrap();
    let unit = compile_full(&parsed).unwrap();
    let route_json = emit(&unit, "x-page")
        .route_json
        .expect("route_json should be Some");
    // BTreeSet → sorted, deduped; PascalCase references appear normalized.
    assert!(
        route_json.contains(r#""components": ["lazy-graph", "my-widget", "user-card"]"#),
        "components must list the referenced component tags (normalized); got:\n{route_json}"
    );
}

/// O1a (tag naming): a single-word PascalCase component reference can never
/// normalize to a valid custom-element name (no hyphen) — compile_full rejects
/// it with C450 for ALL builds.
#[test]
fn c450_single_word_component_reference_is_compile_error() {
    let src = r#"
@route { path: '/x', name: 'x-page' }
@template {
  <div>
    <Comment comment={a} />
  </div>
}
"#;
    let parsed = sfc::parse_with_path(src, Some("src/pages/x.aihu")).unwrap();
    let err = compile_full(&parsed)
        .expect_err("single-word PascalCase component reference must be a C450 error");
    assert_eq!(
        err.code.as_deref(),
        Some("C450"),
        "expected C450, got {err:?}"
    );
    assert!(
        err.message.contains("C450") && err.message.contains("Comment"),
        "C450 message must name the offending tag; got: {}",
        err.message
    );
}

/// O1a (tag naming): multi-word PascalCase references normalize in the emitted
/// JS — `<UserCard>` emits `branch('user-card', …)`, never the raw tag.
#[test]
fn emitted_js_normalizes_pascal_case_component_references() {
    let src = r#"
@template {
  <div>
    <UserCard label={a} />
    <my-widget></my-widget>
  </div>
}
"#;
    let parsed = sfc::parse(src).unwrap();
    let unit = compile_full(&parsed).unwrap();
    let js = emit(&unit, "x-page").js;
    assert!(
        js.contains("branch('user-card'"),
        "PascalCase reference must emit its normalized tag; got:\n{js}"
    );
    assert!(
        !js.contains("branch('UserCard'"),
        "raw PascalCase tag must not survive into emitted JS; got:\n{js}"
    );
    assert!(
        js.contains("branch('my-widget'"),
        "hyphenated reference must pass through; got:\n{js}"
    );
}

/// A plain `onX={handler}` on a child component is a prop, not a DOM event
/// listener. `on:<event>` remains the explicit event-listener spelling.
#[test]
fn component_bound_props_bypass_dom_attribute_lowering() {
    let src = r#"
@state {
  const onSave = () => 'saved'
  const back = () => 'back'
  const label = 'dynamic'
}
@template {
  <child-card onSave={onSave} back={back} label={label} aria-label={label} data-state={label} title="static"></child-card>
  <button onClick={onSave}></button>
}
"#;
    let parsed = sfc::parse(src).unwrap();
    let unit = compile_full(&parsed).unwrap();
    let js = emit(&unit, "x-parent").js;
    for prop in ["onSave", "back", "label"] {
        assert!(
            js.contains(&format!("'__aihu_prop:{prop}':")),
            "component prop `{prop}` must carry the property marker, got:\n{js}"
        );
    }
    for attr in ["aria-label", "data-state"] {
        assert!(
            js.contains(&format!("'{attr}':")),
            "component attribute `{attr}` must keep its public attribute name, got:\n{js}"
        );
        assert!(
            !js.contains(&format!("'__aihu_prop:{attr}':")),
            "component attribute `{attr}` must not use the property marker, got:\n{js}"
        );
    }
    assert!(js.contains("title: 'static'"), "static attributes stay normal, got:\n{js}");
    assert!(js.contains("onClick: onSave"), "native events stay listeners, got:\n{js}");
}

/// A ref on a child custom element must retain its mount-time assignment.
#[test]
fn component_ref_keeps_mount_time_wiring() {
    let src = r#"
@state {
  let childEl: HTMLElement | null = null
}
@template {
  <child-card ref={childEl}></child-card>
}
"#;
    let parsed = sfc::parse(src).unwrap();
    let unit = compile_full(&parsed).unwrap();
    let js = emit(&unit, "x-parent").js;
    assert!(
        js.contains("branch('child-card', undefined, [])"),
        "child element must be emitted, got:\n{js}"
    );
    assert!(
        js.contains("childEl = _el"),
        "child ref must retain its mount-time assignment, got:\n{js}"
    );
}

/// A page with no component references omits the `components` member entirely —
/// existing consumers and the common no-component page stay byte-identical.
#[test]
fn route_json_omits_components_when_none_referenced() {
    let src = r#"
@route { path: '/y', name: 'y-page' }
@template { <div><p>hi</p><span>x</span></div> }
"#;
    let parsed = sfc::parse_with_path(src, Some("src/pages/y.aihu")).unwrap();
    let unit = compile_full(&parsed).unwrap();
    let route_json = emit(&unit, "y-page")
        .route_json
        .expect("route_json should be Some");
    assert!(
        !route_json.contains("components"),
        "no-component page must omit the components member; got:\n{route_json}"
    );
}

/// EmitResult.route_json is None when no @route block.
#[test]
fn v062_route_json_none_without_route_block() {
    let src = r#"
@template {
  <div>Hello</div>
}
"#;
    let parsed = sfc::parse(src).unwrap();
    let unit = compile_full(&parsed).unwrap();
    let result = emit(&unit, "my-widget");
    assert!(result.route_json.is_none());
}

/// route_json: empty path field when @route has no path override.
#[test]
fn v062_route_json_empty_pattern_when_no_path() {
    let src = r#"
@route {
  name: 'home',
  ssr: false
}

@template {
  <div>Home</div>
}
"#;
    let parsed = sfc::parse_with_path(src, Some("src/pages/index.aihu")).unwrap();
    let unit = compile_full(&parsed).unwrap();
    let result = emit(&unit, "home-page");
    let route_json = result.route_json.as_ref().unwrap();
    assert!(route_json.contains(r#""pattern": """#));
    assert!(route_json.contains(r#""ssr": false"#));
}

// ─── v0.6.4 — BuildTarget enum ───────────────────────────────────────────────

/// Default BuildTarget is Universal.
#[test]
fn v064_default_build_target_is_universal() {
    let src = r#"
@template {
  <div>Hello</div>
}
"#;
    let parsed = sfc::parse(src).unwrap();
    let unit = compile_full(&parsed).unwrap();
    assert_eq!(unit.target, BuildTarget::Universal);
}

/// compile_full_with_target sets target correctly.
#[test]
fn v064_compile_full_with_target_client() {
    let src = r#"
@template {
  <div>Hello</div>
}
"#;
    let parsed = sfc::parse(src).unwrap();
    let unit = compile_full_with_target(&parsed, BuildTarget::Client).unwrap();
    assert_eq!(unit.target, BuildTarget::Client);
}

/// compile_full_with_target server variant.
#[test]
fn v064_compile_full_with_target_server() {
    let src = r#"
@template {
  <div>Hello</div>
}
"#;
    let parsed = sfc::parse(src).unwrap();
    let unit = compile_full_with_target(&parsed, BuildTarget::Server).unwrap();
    assert_eq!(unit.target, BuildTarget::Server);
}

// ─── v0.6.6 — Client build emission gates ────────────────────────────────────

/// FEL-434 (closes FEL-423): client build with @agent block EMITS the manifest
/// sidecar (a build-time artifact, not bundled), while the JS still carries the
/// elision comment and no in-bundle registration. Was
/// `v066_client_build_elides_agent_manifest`, which asserted the manifest was
/// suppressed — that suppression starved the agent-readiness generator.
#[test]
fn v066_client_build_emits_agent_manifest_sidecar() {
    let src = r#"
@agent {
  input name: string
  action greet() -> { message: string }
}

@template {
  <div>Hello</div>
}
"#;
    let parsed = sfc::parse(src).unwrap();
    let unit = compile_full_with_target(&parsed, BuildTarget::Client).unwrap();
    let result = emit(&unit, "my-agent");

    // manifest_json IS emitted for client builds now (the sidecar is on-disk,
    // never bundled — zero browser bytes, zero policy in the client output).
    assert!(
        !result.manifest_json.is_empty(),
        "manifest_json (agent-manifest.json sidecar) must be emitted for client builds"
    );
    // JS must still contain the elision comment and no in-bundle registration.
    assert!(
        result.js.contains("// [client build] @agent block elided"),
        "JS should contain elision comment"
    );
    assert!(
        !result.js.contains("registerAgentMetadata"),
        "client JS must NOT carry registerAgentMetadata (in-bundle elision stays)"
    );
}

/// Universal build with @agent block: manifest_json IS emitted normally.
#[test]
fn v066_universal_build_emits_agent_manifest() {
    let src = r#"
@agent {
  input name: string
  action greet() -> { message: string }
}

@template {
  <div>Hello</div>
}
"#;
    let parsed = sfc::parse(src).unwrap();
    let unit = compile_full_with_target(&parsed, BuildTarget::Universal).unwrap();
    let result = emit(&unit, "my-agent");

    assert!(
        !result.manifest_json.is_empty(),
        "manifest_json should be emitted in universal build"
    );
    assert!(
        !result.js.contains("@agent block elided"),
        "JS should not have elision comment in universal build"
    );
}

/// Server build with @agent block: manifest_json IS emitted (only client gates).
#[test]
fn v066_server_build_does_not_elide_agent() {
    let src = r#"
@agent {
  input name: string
  action greet() -> { message: string }
}

@template {
  <div>Hello</div>
}
"#;
    let parsed = sfc::parse(src).unwrap();
    let unit = compile_full_with_target(&parsed, BuildTarget::Server).unwrap();
    let result = emit(&unit, "my-agent");

    // Server build keeps the agent manifest
    assert!(
        !result.manifest_json.is_empty(),
        "manifest_json should be emitted in server build"
    );
}

// ─── v0.6.9 — Conformance fixtures ───────────────────────────────────────────

/// bench/compiler-conformance/route/01-basic-route.aihu route_json matches golden.
#[test]
fn v069_fixture_basic_route_json() {
    let src = include_str!("../../../bench/compiler-conformance/route/01-basic-route.aihu");
    let golden_json =
        include_str!("../../../bench/compiler-conformance/route/01-basic-route.route.json");

    let parsed = sfc::parse_with_path(src, Some("src/pages/users.aihu")).unwrap();
    let unit = compile_full(&parsed).unwrap();
    let result = emit(&unit, "01-basic-route");

    let route_json = result
        .route_json
        .as_ref()
        .expect("route_json should be Some for fixture");
    // Normalize whitespace for comparison
    let actual = route_json.split_whitespace().collect::<Vec<_>>().join(" ");
    let expected = golden_json.split_whitespace().collect::<Vec<_>>().join(" ");
    assert_eq!(actual, expected, "route_json should match golden file");
}

/// bench/compiler-conformance/route/02-route-with-layout.aihu route_json matches golden.
#[test]
fn v069_fixture_route_with_layout_json() {
    let src = include_str!("../../../bench/compiler-conformance/route/02-route-with-layout.aihu");
    let golden_json =
        include_str!("../../../bench/compiler-conformance/route/02-route-with-layout.route.json");

    let parsed = sfc::parse_with_path(src, Some("src/pages/admin/users.aihu")).unwrap();
    let unit = compile_full(&parsed).unwrap();
    let result = emit(&unit, "02-route-with-layout");

    let route_json = result
        .route_json
        .as_ref()
        .expect("route_json should be Some");
    let actual = route_json.split_whitespace().collect::<Vec<_>>().join(" ");
    let expected = golden_json.split_whitespace().collect::<Vec<_>>().join(" ");
    assert_eq!(
        actual, expected,
        "route_json should match golden for layout fixture"
    );
}

// ─── B1 (SEO arc) — per-route head metadata ──────────────────────────────────

/// Full head block round-trips into route_json with title/description/canonical,
/// nested og/twitter objects, and verbatim jsonld.
#[test]
fn b1_route_head_round_trips_into_route_json() {
    let src = r#"
@route {
  path: '/about',
  name: 'about',
  head: {
    title: 'About Us',
    description: 'Who we are',
    canonical: '/about',
    og: { title: 'About', image: '/og.png', type: 'website', url: '/about' },
    twitter: { card: 'summary_large_image', title: 'About', site: '@acme' },
    jsonld: { "@context": "https://schema.org", "@type": "Organization", "name": "Acme" }
  }
}

@template {
  <div>About</div>
}
"#;
    let parsed = sfc::parse_with_path(src, Some("src/pages/about.aihu")).unwrap();

    // Parser: head present with typed sub-objects.
    let head = parsed
        .route
        .as_ref()
        .unwrap()
        .head
        .as_ref()
        .expect("head parsed");
    assert_eq!(head.title.as_deref(), Some("About Us"));
    assert_eq!(head.description.as_deref(), Some("Who we are"));
    assert_eq!(head.canonical.as_deref(), Some("/about"));
    assert_eq!(head.og.as_ref().unwrap().image.as_deref(), Some("/og.png"));
    assert_eq!(head.og.as_ref().unwrap().r#type.as_deref(), Some("website"));
    assert_eq!(
        head.twitter.as_ref().unwrap().site.as_deref(),
        Some("@acme")
    );
    assert!(head
        .jsonld
        .as_ref()
        .unwrap()
        .contains(r#""@context": "https://schema.org""#));

    // Codegen: head member emitted into the sidecar, jsonld verbatim, valid JSON.
    let unit = compile_full(&parsed).unwrap();
    let route_json = emit(&unit, "about").route_json.expect("route_json");
    assert!(route_json.contains(r#""head": {"#));
    assert!(route_json.contains(r#""title": "About Us""#));
    assert!(route_json.contains(r#""og": {"#));
    assert!(route_json.contains(r#""type": "website""#));
    assert!(route_json.contains(r#""twitter": {"#));
    assert!(route_json.contains(r#""card": "summary_large_image""#));
    assert!(route_json.contains(r#""jsonld": {"#));
    assert!(route_json.contains(r#""@type": "Organization""#));

    // The whole sidecar must be valid, parseable JSON.
    let parsed_json: serde_json::Value =
        serde_json::from_str(&route_json).expect("emitted route_json must be valid JSON");
    assert_eq!(parsed_json["head"]["title"], "About Us");
    assert_eq!(parsed_json["head"]["og"]["url"], "/about");
    assert_eq!(
        parsed_json["head"]["twitter"]["card"],
        "summary_large_image"
    );
    assert_eq!(parsed_json["head"]["jsonld"]["@type"], "Organization");
    assert_eq!(
        parsed_json["head"]["jsonld"]["@context"],
        "https://schema.org"
    );
}

/// A route WITHOUT a head key emits a valid route_json with no head member
/// (backward compatible).
#[test]
fn b1_route_without_head_omits_head_member() {
    let src = r#"
@route {
  path: '/plain',
  name: 'plain'
}

@template {
  <div>Plain</div>
}
"#;
    let parsed = sfc::parse_with_path(src, Some("src/pages/plain.aihu")).unwrap();
    assert!(parsed.route.as_ref().unwrap().head.is_none());
    let unit = compile_full(&parsed).unwrap();
    let route_json = emit(&unit, "plain").route_json.expect("route_json");
    assert!(
        !route_json.contains("head"),
        "no head member when head absent"
    );
    let v: serde_json::Value =
        serde_json::from_str(&route_json).expect("route_json must be valid JSON");
    assert!(v.get("head").is_none());
}

/// Conformance fixture 03-route-with-head.aihu route_json matches golden.
#[test]
fn b1_fixture_route_with_head_json() {
    let src = include_str!("../../../bench/compiler-conformance/route/03-route-with-head.aihu");
    let golden_json =
        include_str!("../../../bench/compiler-conformance/route/03-route-with-head.route.json");

    let parsed = sfc::parse_with_path(src, Some("src/pages/about.aihu")).unwrap();
    let unit = compile_full(&parsed).unwrap();
    let result = emit(&unit, "03-route-with-head");

    let route_json = result
        .route_json
        .as_ref()
        .expect("route_json should be Some");
    let actual = route_json.split_whitespace().collect::<Vec<_>>().join(" ");
    let expected = golden_json.split_whitespace().collect::<Vec<_>>().join(" ");
    assert_eq!(
        actual, expected,
        "route_json should match golden for head fixture"
    );
}

/// bench/compiler-conformance/build-target/01-client-elides-agent.aihu
/// — client build produces elision comment.
#[test]
fn v069_fixture_client_elides_agent_js() {
    let src = include_str!(
        "../../../bench/compiler-conformance/build-target/01-client-elides-agent.aihu"
    );

    let parsed = sfc::parse(src).unwrap();
    let unit = compile_full_with_target(&parsed, BuildTarget::Client).unwrap();
    let result = emit(&unit, "01-client-elides-agent");

    // Must have the elision comment.
    assert!(
        result.js.contains("// [client build] @agent block elided"),
        "client build JS should have elision comment"
    );
    // FEL-434: client build now EMITS the manifest sidecar (build-time artifact,
    // never bundled); the in-bundle registration stays elided (comment above).
    assert!(
        !result.manifest_json.is_empty(),
        "client build must emit the agent manifest sidecar (FEL-434)"
    );
}

// ─── SSR string emission for `html={expr}` ──────────────────────────────────

/// `html={expr}` must land in `__ssrString`, not only in the client's
/// mount-time `replaceChildren` effect.
///
/// Regression: `html` was classified as an SSR-transparent element effect, so
/// a page whose body IS an `html` binding serialized as an empty element. Every
/// apps/docs-next guide prerendered to nav chrome plus a hollow `<article>`,
/// which is invisible to crawlers, agents, and agent-readiness graders — while
/// looking correct in a browser, because JS filled it in after load.
#[test]
fn html_binding_is_emitted_into_ssr_string() {
    let src = r#"
@state {
  const body = '<h1>Real content</h1>'
}
@template {
  <article class="prose" html={body}></article>
}
"#;
    let parsed = sfc::parse(src).unwrap();
    let unit = compile_full_with_target(&parsed, BuildTarget::Server).unwrap();
    let js = emit(&unit, "x-page").js;

    let ssr = js
        .lines()
        .find(|l| l.contains("__out +=") && l.contains("<article"))
        .unwrap_or_else(|| panic!("no __ssrString chunk emitted for <article>:\n{js}"));

    assert!(
        ssr.contains("body"),
        "SSR chunk must interpolate the `html` expression, got: {ssr}"
    );
    assert!(
        !ssr.contains("<article class=\"prose\"></article>"),
        "SSR chunk must not serialize the element empty, got: {ssr}"
    );
}

/// `raw` still suppresses children, and wins over `html`.
#[test]
fn raw_attr_still_suppresses_html_binding_in_ssr() {
    let src = r#"
@state {
  const body = '<h1>Real content</h1>'
}
@template {
  <article raw html={body}></article>
}
"#;
    let parsed = sfc::parse(src).unwrap();
    let unit = compile_full_with_target(&parsed, BuildTarget::Server).unwrap();
    let js = emit(&unit, "x-page").js;

    if let Some(ssr) = js
        .lines()
        .find(|l| l.contains("__out +=") && l.contains("<article"))
    {
        assert!(
            !ssr.contains("String((body)"),
            "`raw` must suppress the html interpolation, got: {ssr}"
        );
    }
}

// ─── Child component resolution (SSR children step 3a) ───────────────────────
//
// A reference to another component used to compile to an empty element: the
// child's template lives in a module this compilation never sees. That is why
// every prerendered page shipped an empty `<site-header>`. The reference now
// compiles to a `__aihu_schild(...)` call, which renders the child through the
// registry the caller pre-resolved onto `__opts` — and emits the same empty
// element when no registry is supplied, so nothing changes for a site that has
// not wired one up.

/// Find the emitted `__ssrString` chunk (the single `__out +=` line).
fn ssr_chunk(js: &str) -> String {
    js.lines()
        .find(|l| l.contains("__out +="))
        .unwrap_or_else(|| panic!("no __ssrString chunk emitted:\n{js}"))
        .to_string()
}

fn compile_server_js(src: &str) -> String {
    let parsed = sfc::parse(src).unwrap();
    let unit = compile_full_with_target(&parsed, BuildTarget::Server).unwrap();
    emit(&unit, "x-page").js
}

#[test]
fn component_reference_compiles_to_a_child_render_call() {
    let js = compile_server_js(
        r#"
@template {
  <div class="wrap"><site-header></site-header></div>
}
"#,
    );
    let ssr = ssr_chunk(&js);

    assert!(
        ssr.contains("__aihu_schild('site-header'"),
        "component reference must lower to a child render call, got: {ssr}"
    );
    assert!(
        !ssr.contains("<site-header></site-header>"),
        "the empty-element literal must be gone, got: {ssr}"
    );
    // The helper import rides the same channel as every other SSR helper —
    // the server-only subpath, so these bytes never enter a client bundle.
    // Matched on the LINE rather than an exact string: the import names every
    // helper the emitted body uses, in sorted order, and a component with a
    // root element always also imports `__aihu_eattr` (the root `data-a` stamp
    // escapes through it). Pinning the whole line made this test fail on a
    // change to an unrelated helper.
    let helper_import = js
        .lines()
        .find(|l| l.contains("from '@aihu/runtime/ssr'") && l.starts_with("import"))
        .unwrap_or_else(|| panic!("helper import missing:\n{js}"));
    assert!(
        helper_import.contains("__aihu_schild"),
        "child helper not imported, got: {helper_import}"
    );
}

#[test]
fn the_host_keeps_its_own_hydration_path() {
    // The host IS a node in THIS component's tree, so it keeps its parent-space
    // `data-aihu-path`. The child's tree restarts at ROOT_PATH behind the
    // `data-aihu-ssr` boundary the helper stamps — which is what arbor's
    // hydrate() already expects of a nested marked host.
    let js = compile_server_js(
        r#"
@template {
  <div class="wrap"><h1>Hi</h1><site-header></site-header></div>
}
"#,
    );
    let ssr = ssr_chunk(&js);
    assert!(
        ssr.contains(r#"__aihu_schild('site-header', __h ? ' data-aihu-path="0.1"' : '', __opts)"#),
        "host must carry its own path attr in hydratable output only, got: {ssr}"
    );
}

#[test]
fn pascal_case_reference_is_kebabed_before_lookup() {
    // The registry is keyed by the tag the element actually registers under,
    // so the emitted lookup key must be the normalized name, never the source
    // spelling.
    let js = compile_server_js(
        r#"
@template {
  <div><SiteHeader></SiteHeader></div>
}
"#,
    );
    assert!(
        ssr_chunk(&js).contains("__aihu_schild('site-header'"),
        "PascalCase reference must look up the kebab tag:\n{js}"
    );
}

#[test]
fn v1_boundaries_keep_emitting_the_plain_element() {
    // Each of these is a shape the child renderer deliberately does NOT handle
    // yet, and each must fall back to exactly today's output rather than render
    // a child with wrong props or drop slot content on the floor.
    let cases: [(&str, &str); 3] = [
        // Attributes at a reference site are the child's PROPS. Rendering the
        // child with defaults while the client renders it with real values is a
        // hydration mismatch, so prop forwarding is its own slice.
        (
            r#"@template { <div><site-header title="x"></site-header></div> }"#,
            "attrs",
        ),
        // Children at a reference site are SLOT CONTENT, and slot projection is
        // explicitly unimplemented.
        (
            r#"@template { <div><site-header>hi</site-header></div> }"#,
            "children",
        ),
        // The root element carries the PARENT's `data-a` stamp, which the host
        // attrs passed to the helper do not model.
        (r#"@template { <site-header></site-header> }"#, "root path"),
    ];
    for (src, label) in cases {
        // Assert on the emitted CHUNK, not the whole module: the opts-alias
        // comment names `__aihu_schild` in every artifact, so a module-wide
        // substring check would pass vacuously here and fail vacuously above.
        let ssr = ssr_chunk(&compile_server_js(src));
        assert!(
            !ssr.contains("__aihu_schild"),
            "{label}: must not lower to a child render call yet, got: {ssr}"
        );
        assert!(
            ssr.contains("<site-header"),
            "{label}: must still emit the plain element, got: {ssr}"
        );
    }
}

#[test]
fn the_opts_type_is_spelled_once() {
    // It appears in four positions in the emitted artifact, and `children` has
    // to reach all of them. A named alias is the difference between one
    // declaration and four that can drift.
    let js = compile_server_js(r#"@template { <div>hi</div> }"#);
    assert!(
        js.contains("type __AihuSsrOpts = import('@aihu/runtime/ssr').SsrChildRenderOpts;"),
        "opts alias missing:\n{js}"
    );
    assert!(
        !js.contains("hydratable?: boolean; lightScopeId?: string"),
        "the inline opts type must be gone — it cannot carry `children`:\n{js}"
    );
}

// ─── FEL-440 follow-up — the SSR-entry gate was narrowed from "every agent
// component" to "only an @agent block with $input declarations" ───────────
//
// The original blanket exclusion (`!is_agent_component`) meant a server build
// of ANY component with an exposed $action — including the CLI scaffold's own
// default page, which has no @agent block at all — got no `__ssr` export, and
// fell through to the client-shaped registration form instead: unguarded
// `defineElement`/`new CSSStyleSheet()` at module scope, which throws
// `ReferenceError: CSSStyleSheet is not defined` / `HTMLElement is not
// defined` the moment a plain Node/Bun process (or a Worker) imports it.
//
// The narrower gate excludes only components whose `@agent` block declares
// `$input`s — `emit_agent_bindings` lowers each to `ctx.attrs.<name>[0]()`,
// and the host-less SSR SetupContext passes `attrs: {}`, so indexing into it
// would throw. A plain `$action`/`$state` component, or an `@agent` block that
// carries only policy ($scope/$rate-limit) with no `$input`s, references no
// `ctx.attrs` anywhere in its exposed closures — they all close over the
// setup body's own local signals — so it is exactly as SSR-safe as a
// non-agent component.

/// A component with $action but NO @agent block (the scaffold's own shape)
/// gets the standalone SSR entry under a server build.
#[test]
fn fel440_followup_action_only_gets_ssr_entry() {
    let src = r#"
@state {
import { signal } from '@aihu/signals'
const [count, setCount] = signal(0)

$action: {
  increment: {
    describe: 'Add 1',
    expose: { read: true, write: true },
    handler: () => setCount(count() + 1),
  },
}
}

@template {
  <div>{count()}</div>
}
"#;
    let parsed = sfc::parse(src).unwrap();
    let unit = compile_full_with_target(&parsed, BuildTarget::Server).unwrap();
    let result = emit(&unit, "x-counter");

    assert!(
        result.js.contains("export const __ssr"),
        "an $action-only component must get the standalone SSR entry:\n{}",
        result.js
    );
    assert!(
        result.js.contains("export default __ssr"),
        "…and export it as the default, which renderToString/resolveComponent read:\n{}",
        result.js
    );
    // The DOM-registration path stays module-scope-safe — no unguarded
    // `new CSSStyleSheet()` reachable from a plain import.
    assert!(
        result.js.contains("typeof HTMLElement !== 'undefined'"),
        "the client DOM registration must stay guarded, not unconditional:\n{}",
        result.js
    );
}

/// An @agent block with NO $inputs (policy only) ALSO gets the SSR entry.
#[test]
fn fel440_followup_agent_with_no_inputs_gets_ssr_entry() {
    let src = r#"
@agent {
  $scope: 'read'
  action greet() -> { message: string }
}

@template {
  <div>Hello</div>
}
"#;
    let parsed = sfc::parse(src).unwrap();
    let unit = compile_full_with_target(&parsed, BuildTarget::Server).unwrap();
    let result = emit(&unit, "x-greeter");

    assert!(
        result.js.contains("export const __ssr"),
        "an @agent block with no $inputs must still get the SSR entry — nothing \
         in its exposed closures reads ctx.attrs:\n{}",
        result.js
    );
}

/// An @agent block WITH $inputs is still excluded — this is the one real,
/// still-live reason for the gate, and it must not regress silently.
#[test]
fn fel440_followup_agent_with_inputs_stays_excluded() {
    let src = r#"
@agent {
  input name: string
  action greet() -> { message: string }
}

@template {
  <div>Hello</div>
}
"#;
    let parsed = sfc::parse(src).unwrap();
    let unit = compile_full_with_target(&parsed, BuildTarget::Server).unwrap();
    let result = emit(&unit, "x-greeter-input");

    assert!(
        !result.js.contains("export const __ssr"),
        "an @agent block with $inputs reads ctx.attrs.name[0](), which the \
         host-less SSR SetupContext (attrs: {{}}) cannot satisfy — it must stay \
         excluded from the standalone SSR entry until $inputs get their own \
         inert-signal stub (the way props already do):\n{}",
        result.js
    );
}

// ─── FEL-440 follow-up, part 2 — $aria/$form's ElementInternals wiring is
// null-guarded, and $form-only components join the SSR entry ────────────────
//
// An independent review of the follow-up above surfaced a SEPARATE, deeper
// bug in the same family: `$aria`/`$form`'s ElementInternals wiring
// (`state_emit.rs`'s `INTERNALS_GUARD` plus every per-entry statement) read
// `ctx.element._internals` UNCONDITIONALLY. The host-less SSR SetupContext
// passes `element: null`, so any component reaching the SSR entry with an
// `$aria` block — which was ALREADY possible before this fix, since `$aria`
// alone never gated `emit_ssr_entry` — crashed the instant its setup body
// ran, not merely at import. This was a LIVE bug, independent of the
// agent-component gate above.
//
// `$form` had the opposite problem: it was excluded from the SSR entry
// ENTIRELY, via a dedicated code branch with no SSR logic at all — so a
// `$form`-only component (no props/agent-inputs/`$extends`) never got
// `export const __ssr` regardless of `emit_ssr_entry`'s value.
//
// End-to-end verified (not just string-content asserted here): a real
// scaffolded `output: 'ssr'` app with a component combining `$form` + `$aria`
// as a CHILD reference, driven through a real built Cloudflare Worker —
// before this fix, `TypeError: Cannot read properties of null (reading
// '_internals')` at the exact `_internals` dereference, caught by
// `__aihu_schild`'s fail-closed handling and rendered silently empty (not
// even a visible error — the page still returned 200 with the component just
// missing); after, the component's content renders correctly. These Rust
// tests pin the STRUCTURAL shape (SSR entry present, no unguarded `_internals`
// access) that makes that true; they do not themselves execute the emitted JS.

/// A component using ONLY `$aria` (no `$form`, no props) already reached the
/// SSR entry before this fix — `$aria` alone never touched `emit_ssr_entry`.
/// Every line touching `ctx.element._internals` must be null-guarded, or this
/// is a live crash on every existing `$aria`-only SSR component, not a
/// regression this fix introduces.
#[test]
fn fel440_followup2_aria_only_ssr_entry_has_no_unguarded_internals() {
    let src = r#"
@state {
$aria: {
  role: 'button',
  pressed: false,
}
}

@template {
  <div>Click me</div>
}
"#;
    let parsed = sfc::parse(src).unwrap();
    let unit = compile_full_with_target(&parsed, BuildTarget::Server).unwrap();
    let result = emit(&unit, "x-aria-button");

    assert!(
        result.js.contains("export const __ssr"),
        "an $aria-only component must get the standalone SSR entry:\n{}",
        result.js
    );
    for line in result.js.lines().filter(|l| l.contains("._internals")) {
        assert!(
            line.contains("if (__aihu_el")
                || line.contains("if (!__aihu_el)")
                || line.trim_start().starts_with("const __aihu_el"),
            "every line touching `_internals` must be null-guarded on \
             `__aihu_el` (host-less SSR passes `element: null`) — found an \
             unguarded one:\n  {}\nfull output:\n{}",
            line,
            result.js
        );
    }
}

/// A component using ONLY `$form` (no props/agent-inputs/`$extends`) now gets
/// the SSR entry, with `{ formAssociated: true }` preserved on the
/// CLIENT-side guarded `defineElement` call.
#[test]
fn fel440_followup2_form_only_gets_ssr_entry_with_form_associated() {
    let src = r#"
@state {
import { signal } from '@aihu/signals'
const [val, setVal] = signal('')

$form: {
  value: () => val,
}
}

@template {
  <input value={val()} />
}
"#;
    let parsed = sfc::parse(src).unwrap();
    let unit = compile_full_with_target(&parsed, BuildTarget::Server).unwrap();
    let result = emit(&unit, "x-form-field");

    assert!(
        result.js.contains("export const __ssr"),
        "a $form-only component must get the standalone SSR entry:\n{}",
        result.js
    );
    assert!(
        result.js.contains("formAssociated"),
        "the CLIENT-side guarded defineElement call must still carry \
         `{{ formAssociated: true }}` — this is a real browser behavior, \
         unrelated to the SSR entry, and must not be lost when $form joins \
         the SSR-entry branch:\n{}",
        result.js
    );
    for line in result.js.lines().filter(|l| l.contains("._internals")) {
        assert!(
            line.contains("if (__aihu_el")
                || line.contains("if (!__aihu_el)")
                || line.trim_start().starts_with("const __aihu_el"),
            "every line touching `_internals` must be null-guarded:\n  {}\nfull output:\n{}",
            line,
            result.js
        );
    }
}

/// `$form` combined with `$prop`/agent-inputs/`$extends` (the `ssr_options`
/// branch) is DELIBERATELY still excluded — `define_opts` is not yet threaded
/// through that branch. This pins the boundary so it is a decision, not a gap
/// discovered later.
#[test]
fn fel440_followup2_form_with_props_stays_excluded() {
    let src = r#"
@state {
$prop: {
  label: { type: 'string', default: '' },
}

$form: {
  value: () => label,
}
}

@template {
  <input />
}
"#;
    let parsed = sfc::parse(src).unwrap();
    let unit = compile_full_with_target(&parsed, BuildTarget::Server).unwrap();
    let result = emit(&unit, "x-form-with-prop");

    assert!(
        !result.js.contains("export const __ssr"),
        "$form combined with $prop is a deliberately narrower exclusion than \
         plain $form — this must stay excluded until `define_opts` is \
         threaded through the options-form SSR branch too:\n{}",
        result.js
    );
}

// ─── `$extends` (`base:`) under a server build ──────────────────────────────
//
// The third and last of the SSR-entry exclusions filed alongside the
// `$aria`/`$form` guards. Its stated reason was accurate but was a fact about
// `@aihu/primitives`, NOT about this gate: the imported base module evaluated
// `class … extends HTMLElement` at its OWN module scope, so a server bundle
// threw `ReferenceError: HTMLElement is not defined` on IMPORT — before
// anything the compiler emits could run. Every primitive now extends
// `HTMLElementBase` (SSR-safe conditional base), so that reason is gone and
// the exclusion here was the only thing left.
//
// The end-to-end proof is `packages/app/tests/workers-ssr-e2e.test.ts`
// assertion 15 (a real built Worker, driven). These pin the emitted STRUCTURE
// so the gate cannot silently regress without a 10-second vite build.

/// A `$extends` component gets the options-form SSR entry.
#[test]
fn extends_base_gets_ssr_entry() {
    let src = r#"
@state {
import { AihuSwitchRoot } from '@aihu/primitives/switch'

base: AihuSwitchRoot
}

@template {
  <span>EXTENDS-OK</span>
}
"#;
    let parsed = sfc::parse(src).unwrap();
    let unit = compile_full_with_target(&parsed, BuildTarget::Server).unwrap();
    let result = emit(&unit, "x-switch");

    assert!(
        result.js.contains("export const __ssr"),
        "a $extends component must get the options-form SSR entry — the base \
         module is import-safe now, and `base:` only affects the CLIENT class:\n{}",
        result.js
    );
    assert!(
        result.js.contains("export default __ssr"),
        "…and export it as the default, which renderToString/resolveComponent read:\n{}",
        result.js
    );
    // `base:` must still reach the runtime — the SSR entry must not have been
    // bought by dropping the class extension on the client half.
    assert!(
        result.js.contains("base: AihuSwitchRoot"),
        "the base class must still be threaded into defineComponent:\n{}",
        result.js
    );
}

/// The `defineElement` registration for a `$extends` component stays behind the
/// DOM-globals guard.
#[test]
fn extends_base_registration_is_dom_guarded() {
    let src = r#"
@state {
import { AihuSwitchRoot } from '@aihu/primitives/switch'

base: AihuSwitchRoot
}

@template {
  <span>EXTENDS-OK</span>
}
"#;
    let parsed = sfc::parse(src).unwrap();
    let unit = compile_full_with_target(&parsed, BuildTarget::Server).unwrap();
    let result = emit(&unit, "x-switch");

    // THIS is the half the import-safe base does not buy on its own. Before,
    // a $extends component fell through to the plain client shape: a bare
    // `defineElement(...)` at module scope, which throws
    // `ReferenceError: customElements is not defined` in a Worker even when
    // every primitive it imports loads cleanly. Verified by reverting this
    // gate alone against a real built Worker.
    assert!(
        result.js.contains(
            "typeof HTMLElement !== 'undefined' && typeof customElements !== 'undefined'"
        ),
        "the client DOM registration must be guarded, not unconditional:\n{}",
        result.js
    );
    let define_at = result
        .js
        .find("defineElement(")
        .expect("no defineElement call emitted");
    let guard_at = result
        .js
        .find("typeof HTMLElement !== 'undefined'")
        .expect("no DOM guard emitted");
    assert!(
        guard_at < define_at,
        "the guard must PRECEDE the registration, not merely coexist with it:\n{}",
        result.js
    );
}

/// A CLIENT build of the same component is unchanged — no SSR entry, and the
/// registration is the plain unguarded call it has always been.
#[test]
fn extends_base_client_build_is_unchanged() {
    let src = r#"
@state {
import { AihuSwitchRoot } from '@aihu/primitives/switch'

base: AihuSwitchRoot
}

@template {
  <span>EXTENDS-OK</span>
}
"#;
    let parsed = sfc::parse(src).unwrap();
    let unit = compile_full_with_target(&parsed, BuildTarget::Client).unwrap();
    let result = emit(&unit, "x-switch");

    assert!(
        !result.js.contains("export const __ssr"),
        "the SSR entry is a server-target artifact; a client build must not \
         grow one:\n{}",
        result.js
    );
    assert!(
        result.js.contains("base: AihuSwitchRoot"),
        "the client build must still extend the base class:\n{}",
        result.js
    );
}

/// `$extends` COMBINED with `$form` stays excluded — the documented narrower
/// hole (`define_opts` is still not threaded through the options-form SSR
/// branch), and it must not be lifted by accident.
///
/// Authored in the legacy `$`-form dialect throughout: `base:` is the WRAPPER
/// spelling, and C625 rejects a `@state` block that mixes wrapper declarations
/// with `$`-macros. `$extends:` and `base:` parse to the same
/// `StateMacro::Extends`, so this exercises the identical gate.
#[test]
fn extends_base_with_form_stays_excluded() {
    let src = r#"
@state {
import { AihuSwitchRoot } from '@aihu/primitives/switch'

$extends: AihuSwitchRoot

$form: {
  value: () => 'on',
}
}

@template {
  <span>EXTENDS-OK</span>
}
"#;
    let parsed = sfc::parse(src).unwrap();
    let unit = compile_full_with_target(&parsed, BuildTarget::Server).unwrap();
    let result = emit(&unit, "x-switch-form");

    assert!(
        !result.js.contains("export const __ssr"),
        "$extends + $form is a deliberately narrower exclusion than plain \
         $extends — it stays excluded until `define_opts` is threaded through \
         the options-form SSR branch:\n{}",
        result.js
    );
}
