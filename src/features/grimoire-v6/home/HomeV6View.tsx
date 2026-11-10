/* eslint-disable */
// Hand-maintained port of the Claude Design v7 tablet Home ("New Design/design_handoff_silverwick_v7/design_files/
// Silverwick Home v7.dc.html"), value for value. The prototype's 1524x968 bezel is a device mock: the product is its
// 1480x924 screen. The design's Player panel (name and game code) is not shown on the tablet: players join by the
// invitation link or QR (streamlining review F-06), so it has no view-model here.
import { Fragment } from 'react';
import { css, T } from './designRuntime';

const RED = '#e8584a';
const LINE = 'rgba(176,186,204,.18)';
const FELL = "'IM Fell English', serif";
const BUY_URL = 'https://bloodontheclocktower.com/products/blood-on-the-clocktower-the-game';
const GITHUB_URL = 'https://github.com/Kaijumomo/Silverwick-Hallow';

const S0: React.CSSProperties = { "position": "absolute", "left": "50%", "top": "50%", "width": "1480px", "height": "924px", "overflow": "hidden", "background": "#0b0909", "transform": "translate(-50%, -50%) scale(var(--home-fit, 1))", "transformOrigin": "center center", "fontFamily": "'Source Sans 3', system-ui, sans-serif", "fontVariantNumeric": "lining-nums tabular-nums", "color": "#ddd6c8" };
const S1: React.CSSProperties = { "position": "absolute", "inset": "0", "background": "linear-gradient(90deg, rgba(9,10,15,.85) 0%, rgba(9,10,15,.5) 42%, rgba(9,10,15,.2) 70%, rgba(9,10,15,.3) 100%), linear-gradient(180deg, rgba(9,10,15,0) 50%, rgba(9,10,15,.8) 100%)" };
const S2: React.CSSProperties = { "position": "absolute", "inset": "0", "pointerEvents": "none", "background": "radial-gradient(ellipse 100% 90% at 50% 50%, transparent 55%, rgba(0,0,0,.6) 100%)" };
const S3: React.CSSProperties = { "position": "absolute", "left": "96px", "top": "166px", "width": "560px", "display": "flex", "flexDirection": "column", "justifyContent": "flex-start", "gap": "52px" };
const S4: React.CSSProperties = { "display": "flex", "flexDirection": "column", "justifyContent": "flex-end", "gap": "16px", "height": "240px" };
const S5: React.CSSProperties = { "fontSize": "12px", "letterSpacing": ".5em", "textTransform": "uppercase", "fontWeight": "600", "color": "rgba(222,216,204,.6)" };
const S6: React.CSSProperties = { "fontFamily": "'Cinzel Decorative', serif", "fontSize": "80px", "fontWeight": "400", "lineHeight": ".98", "color": "#ece6da", "letterSpacing": ".03em", "textShadow": "0 0 40px rgba(232,88,74,.25), 0 2px 0 rgba(0,0,0,.6)" };
const S7: React.CSSProperties = { "fontFamily": FELL, "fontStyle": "italic", "fontSize": "22px", "color": "rgba(236,230,218,.75)" };
const S8: React.CSSProperties = { "display": "flex", "flexDirection": "column", "borderBottom": `1px solid ${LINE}` };
const S9: React.CSSProperties = { "display": "flex", "alignItems": "center", "justifyContent": "space-between", "gap": "20px", "minHeight": "84px", "padding": "0 4px", "border": "none", "borderTop": `1px solid ${LINE}`, "background": "transparent", "textAlign": "left", "fontFamily": "inherit", "cursor": "pointer" };
const S10: React.CSSProperties = { "display": "flex", "flexDirection": "column", "gap": "2px", "minWidth": "0" };
const S11: React.CSSProperties = { "fontSize": "15px", "color": "rgba(222,216,204,.6)" };
const S12: React.CSSProperties = { "position": "absolute", "right": "40px", "top": "0", "bottom": "0", "width": "760px", "pointerEvents": "none", "background": "radial-gradient(ellipse 50% 46% at 50% 52%, rgba(232,88,74,.26), rgba(232,88,74,.08) 55%, transparent 75%)", "animation": "swFlicker 4s ease-in-out infinite" };
const S13: React.CSSProperties = { "position": "absolute", "right": "150px", "top": "310px", "bottom": "70px", "width": "520px", "display": "flex", "flexDirection": "column", "alignItems": "center", "justifyContent": "flex-start", "gap": "30px" };
const S14: React.CSSProperties = { "display": "flex", "alignItems": "center", "gap": "14px", "width": "260px" };
const S15: React.CSSProperties = { "flex": "1", "height": "1px", "background": "linear-gradient(90deg, transparent, rgba(232,88,74,.7))" };
const S16: React.CSSProperties = { "width": "8px", "height": "8px", "transform": "rotate(45deg)", "border": `1px solid ${RED}` };
const S17: React.CSSProperties = { "flex": "1", "height": "1px", "background": "linear-gradient(270deg, transparent, rgba(232,88,74,.7))" };
const S18: React.CSSProperties = { "display": "flex", "flexDirection": "column", "gap": "8px", "alignItems": "center", "textAlign": "center" };
const S19: React.CSSProperties = { "fontFamily": FELL, "textTransform": "uppercase", "fontVariantNumeric": "lining-nums", "letterSpacing": ".06em", "fontSize": "40px", "fontWeight": "400", "color": "#ece6da" };
const S20: React.CSSProperties = { "fontFamily": FELL, "fontStyle": "italic", "fontSize": "18px", "color": "rgba(236,230,218,.65)" };
const S27: React.CSSProperties = { "display": "flex", "flexDirection": "column", "justifyContent": "center", "gap": "8px", "height": "80px", "alignItems": "center", "textAlign": "center" };
const S28: React.CSSProperties = { ...S19, "lineHeight": "1.2" };
const S29: React.CSSProperties = { "display": "flex", "flexDirection": "column", "width": "100%", "borderTop": `1px solid ${LINE}` };
const S30: React.CSSProperties = { "display": "flex", "justifyContent": "space-between", "alignItems": "center", "gap": "12px", "minHeight": "84px", "padding": "0 4px", "border": "none", "borderBottom": `1px solid ${LINE}`, "background": "transparent", "textAlign": "left", "fontFamily": "inherit", "cursor": "pointer" };
const S31: React.CSSProperties = { "display": "flex", "flexDirection": "column", "gap": "2px" };
const S32: React.CSSProperties = { "fontFamily": FELL, "fontSize": "26px", "fontWeight": "400", "color": "#ffb4a6" };
const S33: React.CSSProperties = { "fontSize": "22px", "color": RED };
const S34: React.CSSProperties = { "display": "flex", "justifyContent": "space-between", "alignItems": "center", "gap": "12px", "minHeight": "84px", "padding": "0 4px", "borderBottom": `1px solid ${LINE}`, "textAlign": "left" };
const S35: React.CSSProperties = { "fontFamily": FELL, "fontSize": "26px", "fontWeight": "400", "color": "#ece6da" };
const S36: React.CSSProperties = { "width": "640px", "display": "grid", "gridTemplateColumns": "repeat(4, minmax(0,1fr))", "gap": "14px", "paddingTop": "6px" };
const S37: React.CSSProperties = { "display": "flex", "flexDirection": "column", "alignItems": "center", "gap": "10px", "padding": "14px 8px 16px", "border": "1px solid rgba(176,186,204,.16)", "borderRadius": "12px", "background": "rgba(12,9,8,.35)", "cursor": "pointer", "fontFamily": "inherit" };
const S38: React.CSSProperties = { "fontSize": "13px", "color": "rgba(222,216,204,.6)" };
const S39: React.CSSProperties = { "position": "relative", "width": "128px", "height": "128px", "display": "flex", "alignItems": "center", "justifyContent": "center" };
const S40: React.CSSProperties = { "position": "absolute", "inset": "0", "animation": "swSpin 40s linear infinite" };
const S41: React.CSSProperties = { "position": "relative", "fontFamily": FELL, "fontSize": "11px", "fontWeight": "400", "lineHeight": "1.1", "letterSpacing": ".08em", "textTransform": "uppercase", "textAlign": "center", "color": "#ece6da", "textShadow": "0 1px 3px rgba(0,0,0,.9)" };
// How to Play panel (the Home's fourth right-hand view)
const SH0: React.CSSProperties = { ...S20, "maxWidth": "420px" };
const SH1: React.CSSProperties = { "position": "relative", "width": "100%", "display": "grid", "gridTemplateColumns": "repeat(7, minmax(0,1fr))" };
const SH2: React.CSSProperties = { "position": "absolute", "left": "7%", "right": "7%", "top": "21px", "height": "1px", "background": "rgba(176,186,204,.25)" };
const SH3: React.CSSProperties = { "position": "relative", "minHeight": "44px", "display": "flex", "flexDirection": "column", "alignItems": "center", "justifyContent": "flex-start", "gap": "10px", "padding": "16px 0 0", "border": "none", "background": "transparent", "cursor": "pointer", "fontFamily": "inherit" };
const SH4: React.CSSProperties = { "minHeight": "60px", "padding": "0 44px", "fontSize": "22px", "borderRadius": "28px", "border": "1px solid rgba(255,122,104,.7)", "background": "linear-gradient(180deg, rgba(232,88,74,.28), rgba(192,57,46,.18))", "boxShadow": "0 0 30px rgba(232,88,74,.22), inset 0 1px 0 rgba(236,230,218,.25)", "fontFamily": FELL, "textTransform": "uppercase", "letterSpacing": ".14em", "fontWeight": "400", "color": "#ffb4a6", "whiteSpace": "nowrap", "cursor": "pointer" };
// Community Created Content footer
const SF0: React.CSSProperties = { "position": "absolute", "left": "96px", "bottom": "28px", "display": "flex", "alignItems": "center", "gap": "18px" };
const SF1: React.CSSProperties = { "flex": "none", "display": "block", "width": "150px" };
const SF2: React.CSSProperties = { "display": "block", "width": "150px", "height": "auto" };
const SF3: React.CSSProperties = { "display": "flex", "flexDirection": "column", "gap": "6px" };
const SF4: React.CSSProperties = { "fontSize": "12px", "color": "rgba(222,216,204,.55)" };
const SF5: React.CSSProperties = { "display": "flex", "gap": "18px" };
const SF6: React.CSSProperties = { "fontSize": "13px", "color": "rgba(236,230,218,.7)", "textDecoration": "underline", "textDecorationColor": "rgba(232,88,74,.5)", "textUnderlineOffset": "3px" };

function Rule() {
  return (
    <div style={S14}>
      <span style={S15} />
      <span style={S16} />
      <span style={S17} />
    </div>
  );
}

export function HomeV6View({ vm }: { vm: any }) {
  return (
    <>
      <div id="home-screen" style={S0}>
        {T(vm.homeBg)}
        <div style={S1} />
        <div style={S2} />
        <div style={S3}>
          <div style={S4}>
            <div style={S5}>
              A Blood on the Clocktower companion
            </div>
            <div style={S6}>
              Silverwick
              <br />
              Hollow
            </div>
            <div style={S7}>
              Light the candles. The town is gathering.
            </div>
          </div>
          <div data-left-list="1" style={S8}>
            {(vm.oC?.paths ?? []).map((p: any, p$i: number) => (
              <Fragment key={p$i}>
                <button onClick={p?.pick} className="hh-h0" style={S9}>
                  <span style={S10}>
                    <span style={css(`font-family:'IM Fell English', serif; font-size:30px; font-weight:400; line-height:1.05; color:${p?.titleColor ?? ''}; transition:color .3s;`)}>
                      {T(p?.title)}
                    </span>
                    <span style={S11}>
                      {T(p?.desc)}
                    </span>
                  </span>
                  <span style={css(`font-size:22px; color:${p?.arrowColor ?? ''}; transition:color .3s;`)}>
                    ›
                  </span>
                </button>
              </Fragment>
            ))}
          </div>
        </div>
        <div style={S12} />
        <div style={S13}>
          <Rule />
          {vm.oC?.isS && (
            <>
            <div style={S27}>
              <div style={S28}>
                The Grimoire
              </div>
              <div style={S20}>
                The town awaits its Storyteller.
              </div>
            </div>
            <div data-right-list="1" style={S29}>
              <button onClick={vm.newGame} className="hh-h2" style={S30}>
                <span style={S31}>
                  <span style={S32}>
                    New game
                  </span>
                  <span style={S11}>
                    Choose a script and gather the town
                  </span>
                </span>
                <span style={S33}>
                  ›
                </span>
              </button>
              {(vm.resumeRows ?? []).map((rr: any, rr$i: number) => (
                <Fragment key={rr$i}>
                  <a href="#" onClick={rr?.go} style={S34}>
                    <span style={S31}>
                      <span style={S35}>
                        {T(rr?.title)}
                      </span>
                      <span style={S11}>
                        {T(rr?.sub)}
                      </span>
                    </span>
                    <span style={S33}>
                      ›
                    </span>
                  </a>
                </Fragment>
              ))}
              <a href="#" onClick={vm.openDisplay} style={S34}>
                <span style={S31}>
                  <span style={S35}>
                    Public display
                  </span>
                  <span style={S11}>
                    Put the town square on a TV everyone can see
                  </span>
                </span>
                <span style={S33}>
                  ›
                </span>
              </a>
            </div>
            </>
          )}
          {vm.oC?.isR && (
            <>
            <div style={S18}>
              <div style={S19}>
                Character Reference
              </div>
              <div style={S20}>
                Browse scripts, abilities and night order.
              </div>
            </div>
            <div style={S36}>
              {(vm.scriptsL ?? []).map((sc: any, sc$i: number) => (
                <Fragment key={sc$i}>
                  <button onClick={sc?.open} className="hh-h3" style={S37}>
                    <span role="img" aria-label={sc?.name} style={css(`width:128px; height:128px; background-image:url(${sc?.logo ?? ''}); background-size:contain; background-position:center; background-repeat:no-repeat; filter:drop-shadow(0 6px 10px rgba(0,0,0,.6));`)} />
                    <span style={S38}>
                      {T(sc?.count)}
                    </span>
                  </button>
                </Fragment>
              ))}
              <button onClick={vm.openCarousel} className="hh-h3" style={S37}>
                <span role="img" aria-label="The Carousel" style={S39}>
                  <span style={S40}>
                    {(vm.carouselIcons ?? []).map((ci: any, ci$i: number) => (
                      <Fragment key={ci$i}>
                        <span style={css(`position:absolute; left:${ci?.x ?? ''}px; top:${ci?.y ?? ''}px; width:30px; height:30px; background-image:url(${ci?.src ?? ''}); animation:swSpin 40s linear infinite reverse; background-size:contain; background-position:center; background-repeat:no-repeat; filter:drop-shadow(0 3px 4px rgba(0,0,0,.7));`)} />
                      </Fragment>
                    ))}
                  </span>
                  <span style={S41}>
                    The
                    <br />
                    Carousel
                  </span>
                </span>
                <span style={S38}>
                  Experimental
                </span>
              </button>
            </div>
            </>
          )}
          {vm.oC?.isH && (
            <>
            <div style={S18}>
              <div style={S19}>
                How to Play
              </div>
              <div style={SH0}>
                Seven steps through a game, from the first night to the final vote.
              </div>
            </div>
            <div style={SH1}>
              <span style={SH2} />
              {(vm.howSteps ?? []).map((sp: any, sp$i: number) => (
                <Fragment key={sp$i}>
                  <button onClick={sp?.go} aria-label={sp?.title} style={SH3}>
                    <span style={css(`width:11px; height:11px; transform:rotate(45deg); background:${sp?.dia ?? ''}; border:1px solid ${sp?.border ?? ''}; box-shadow:${sp?.glow ?? ''};`)} />
                    <span style={css(`font-size:12px; letter-spacing:.14em; text-transform:uppercase; font-weight:600; color:${sp?.lab ?? ''}; white-space:nowrap;`)}>
                      {T(sp?.title)}
                    </span>
                  </button>
                </Fragment>
              ))}
            </div>
            <button onClick={vm.howBegin} style={SH4}>
              Begin
            </button>
            </>
          )}
          <Rule />
        </div>
        <div style={SF0}>
          <a href={BUY_URL} target="_blank" rel="noopener" aria-label="Community Created Content. Buy Blood on the Clocktower" style={SF1}>
            <img src="/brand/CommunityCreatedContentParchment.png" alt="Community Created Content" style={SF2} />
          </a>
          <div style={SF3}>
            <span style={SF4}>
              Unofficial fan companion. Not affiliated with The Pandemonium Institute.
            </span>
            <span style={SF5}>
              <a href={BUY_URL} target="_blank" rel="noopener" style={SF6}>Buy Blood on the Clocktower</a>
              <a href={GITHUB_URL} target="_blank" rel="noopener" style={SF6}>GitHub</a>
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
