"use client";

import { useRouter, usePathname } from "next/navigation";
import { ShieldCheck } from "lucide-react";




const NAV_LINKS = [
  { label: "Dashboard",      href: "/",           matchExact: true  },
  { label: "Ward overview",  href: "/wardview",   matchExact: false },
  { label: "Clinician",      href: "/clinician",  matchExact: false },
];

export default function BiasGuardNav({ right, status = "none", slim = false }) {
  const router   = useRouter();
  const pathname = usePathname();

  const isActive = (link) =>
    link.matchExact ? pathname === link.href : pathname.startsWith(link.href);

  return (
    <nav style={{
      borderBottom:    "1px solid rgba(255,255,255,0.07)",
      background:      "rgba(7,12,24,0.96)",
      backdropFilter:  "blur(14px)",
      WebkitBackdropFilter: "blur(14px)",
      position:        "sticky",
      top:             0,
      zIndex:          100,
      padding:         "0 2rem",
    }}>
      <div style={{
        maxWidth:      1280,
        margin:        "0 auto",
        height:        slim ? 56 : 62,
        display:       "flex",
        alignItems:    "center",
        gap:           0,
      }}>

        {/* ── Brand ──────────────────────────────────────── */}
        <button
          onClick={() => router.push("/")}
          style={{
            display:        "flex",
            alignItems:     "center",
            gap:            10,
            background:     "none",
            border:         "none",
            cursor:         "pointer",
            padding:        "0 20px 0 0",
            flexShrink:     0,
            borderRight:    "1px solid rgba(255,255,255,0.06)",
            marginRight:    20,
            height:         "100%",
          }}
        >
          <div style={{
            width:          28,
            height:         28,
            borderRadius:   8,
            background:     "linear-gradient(135deg, #6366f1 0%, #818cf8 100%)",
            display:        "flex",
            alignItems:     "center",
            justifyContent: "center",
            flexShrink:     0,
          }}>
            <ShieldCheck size={14} color="#fff" strokeWidth={2.5} />
          </div>
          <div style={{ textAlign: "left" }}>
            <div style={{
              fontSize:       13,
              fontWeight:     700,
              color:          "#fff",
              letterSpacing:  "-0.02em",
              lineHeight:     1.1,
            }}>
              BiasGuard
            </div>
            <div style={{
              fontSize:       9,
              color:          "rgba(148,163,184,0.4)",
              letterSpacing:  "0.1em",
              textTransform:  "uppercase",
              lineHeight:     1,
              marginTop:      2,
            }}>
              Federated ICU
            </div>
          </div>
        </button>

        {/* ── Nav links ──────────────────────────────────── */}
        <div style={{
          display:    "flex",
          alignItems: "center",
          gap:        2,
          flex:       1,
        }}>
          {NAV_LINKS.map(link => {
            const active = isActive(link);
            return (
              <button
                key={link.href}
                onClick={() => router.push(link.href)}
                style={{
                  padding:        "6px 14px",
                  borderRadius:   8,
                  fontSize:       13,
                  fontWeight:     active ? 600 : 400,
                  color:          active ? "#e2e8f0" : "rgba(148,163,184,0.5)",
                  background:     active ? "rgba(255,255,255,0.07)" : "transparent",
                  border:         "none",
                  cursor:         "pointer",
                  transition:     "all 0.15s",
                  letterSpacing:  "-0.01em",
                  position:       "relative",
                }}
                onMouseEnter={e => {
                  if (!active) e.currentTarget.style.color = "rgba(226,232,240,0.8)";
                }}
                onMouseLeave={e => {
                  if (!active) e.currentTarget.style.color = "rgba(148,163,184,0.5)";
                }}
              >
                {link.label}
                {/* Active underline */}
                {active && (
                  <span style={{
                    position:     "absolute",
                    bottom:       -1,
                    left:         "50%",
                    transform:    "translateX(-50%)",
                    width:        "60%",
                    height:       2,
                    background:   "linear-gradient(90deg, #6366f1, #818cf8)",
                    borderRadius: 2,
                  }} />
                )}
              </button>
            );
          })}
        </div>

        {/* ── Status pill ────────────────────────────────── */}
        {status !== "none" && (
          <div style={{
            display:      "flex",
            alignItems:   "center",
            gap:          7,
            background:   "rgba(255,255,255,0.04)",
            border:       "1px solid rgba(255,255,255,0.08)",
            borderRadius: 20,
            padding:      "5px 12px",
            marginRight:  12,
            flexShrink:   0,
          }}>
            <span style={{ position: "relative", display: "flex", width: 7, height: 7 }}>
              {status === "federating" && (
                <span style={{
                  position:    "absolute",
                  inset:       0,
                  borderRadius: "50%",
                  background:  "#34d399",
                  opacity:     0.7,
                  animation:   "navping 1.2s ease-in-out infinite",
                }} />
              )}
              <span style={{
                position:    "relative",
                width:       7,
                height:      7,
                borderRadius: "50%",
                background:  status === "federating" ? "#10b981" : "rgba(100,116,139,0.5)",
                display:     "inline-block",
              }} />
            </span>
            <span style={{
              fontSize:      11,
              fontWeight:    500,
              color:         status === "federating" ? "#34d399" : "rgba(100,116,139,0.8)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              fontFamily:    "monospace",
            }}>
              {status === "federating" ? "Federating" : "Complete"}
            </span>
          </div>
        )}

        {/* ── Right slot ─────────────────────────────────── */}
        {right && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {right}
          </div>
        )}
      </div>

      <style>{`
        @keyframes navping {
          0%, 100% { transform: scale(1); opacity: 0.7; }
          50%       { transform: scale(2); opacity: 0;   }
        }
      `}</style>
    </nav>
  );
}