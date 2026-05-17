import { useRegisterSW } from 'virtual:pwa-register/react'

export function usePWAUpdate() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, r) {
      if (r) {
        setInterval(() => {
          r.update()
        }, 30 * 60 * 1000)
      }
    },
    onRegisterError(error) {
      console.error('SW registration error:', error)
    },
  })

  const update = () => {
    updateServiceWorker(true)
  }

  const dismiss = () => {
    setNeedRefresh(false)
  }

  return { needRefresh, update, dismiss }
}
