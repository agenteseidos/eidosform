'use client'

/**
 * EidosForm — PixelInjector
 * Sprint Dia 3
 *
 * Injeta pixels de rastreamento conforme IDs configurados no form.
 * Eventos:
 *   onLoad  → Meta PageView | TikTok ViewContent
 *   onSubmit → Meta CompleteRegistration + Lead | Google Ads gtag | TikTok SubmitForm | GTM dataLayer
 */

import { useEffect } from 'react'
import Script from 'next/script'

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

export interface PixelConfig {
  meta_pixel_id?: string | null
  google_ads_id?: string | null
  google_ads_label?: string | null
  tiktok_pixel_id?: string | null
  gtm_id?: string | null
}

interface PixelInjectorProps {
  config: PixelConfig
  /** Chame triggerSubmit() para disparar eventos de conversão */
  onReady?: (trigger: () => void) => void
}

/* ------------------------------------------------------------------ */
/* Helpers — window type extensions                                     */
/* ------------------------------------------------------------------ */

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void
    _fbq?: unknown
    gtag?: (...args: unknown[]) => void
    dataLayer?: unknown[]
    ttq?: {
      load: (id: string) => void
      page: () => void
      track: (event: string, params?: Record<string, unknown>) => void
    }
  }
}

/* ------------------------------------------------------------------ */
/* Component                                                            */
/* ------------------------------------------------------------------ */

export function PixelInjector({ config, onReady }: PixelInjectorProps) {
  const {
    meta_pixel_id,
    google_ads_id,
    google_ads_label,
    tiktok_pixel_id,
    gtm_id,
  } = config

  /* ---------- onLoad events ---------- */
  useEffect(() => {
    // TikTok ViewContent (com polling para aguardar ttq carregar)
    if (tiktok_pixel_id) {
      const tryTikTok = () => {
        if (window.ttq) {
          window.ttq.page()
          window.ttq.track('ViewContent')
        } else {
          setTimeout(tryTikTok, 300)
        }
      }
      setTimeout(tryTikTok, 500)
    }
    // Meta PageView já é disparado inline no script de init
  }, [meta_pixel_id, tiktok_pixel_id])

  /* ---------- expose triggerSubmit ---------- */
  useEffect(() => {
    if (!onReady) return

    const triggerSubmit = () => {
      // Meta: CompleteRegistration + Lead
      if (meta_pixel_id && typeof window.fbq === 'function') {
        window.fbq('track', 'CompleteRegistration')
        window.fbq('track', 'Lead')
      }

      // Google Ads conversion
      if (google_ads_id && google_ads_label && typeof window.gtag === 'function') {
        window.gtag('event', 'conversion', {
          send_to: `${google_ads_id}/${google_ads_label}`,
        })
      }

      // TikTok SubmitForm
      if (tiktok_pixel_id && window.ttq) {
        window.ttq.track('SubmitForm')
      }

      // GTM dataLayer
      if (gtm_id) {
        window.dataLayer = window.dataLayer ?? []
        window.dataLayer.push({ event: 'form_submit', form_id: gtm_id })
      }
    }

    onReady(triggerSubmit)
  }, [meta_pixel_id, google_ads_id, google_ads_label, tiktok_pixel_id, gtm_id, onReady])

  return (
    <>
      {/* Meta Pixel já injetado server-side em app/f/[slug]/page.tsx — não duplicar aqui */}

      {/* ── Google Ads (gtag) ── */}
      {google_ads_id && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${google_ads_id}`}
            strategy="afterInteractive"
          />
          <Script id="google-ads" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${google_ads_id}');
            `}
          </Script>
        </>
      )}

      {/* ── TikTok Pixel ── */}
      {tiktok_pixel_id && (
        <Script id="tiktok-pixel" strategy="afterInteractive">
          {`
            !function (w, d, t) {
              w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];
              ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];
              ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};
              for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);
              ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};
              ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";
              ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};
              var o=document.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;
              var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};
              ttq.load('${tiktok_pixel_id}');
              ttq.page();
            }(window, document, 'ttq');
          `}
        </Script>
      )}

      {/* ── Google Tag Manager ── */}
      {gtm_id && (
        <>
          <Script id="gtm" strategy="afterInteractive">
            {`
              (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
              new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
              j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
              'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
              })(window,document,'script','dataLayer','${gtm_id}');
            `}
          </Script>
          <noscript>
            <iframe
              src={`https://www.googletagmanager.com/ns.html?id=${gtm_id}`}
              height="0"
              width="0"
              style={{ display: 'none', visibility: 'hidden' }}
            />
          </noscript>
        </>
      )}
    </>
  )
}
