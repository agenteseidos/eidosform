'use client'

import { useState, useEffect } from 'react'
import { OnboardingModal } from '@/components/onboarding/onboarding-modal'

interface OnboardingWrapperProps {
  isNewUser: boolean
}

export function OnboardingWrapper({ isNewUser }: OnboardingWrapperProps) {
  const [showOnboarding, setShowOnboarding] = useState(false)

  useEffect(() => {
    if (!isNewUser) return
    const dismissed = localStorage.getItem('eidosform_onboarding_done')
    if (!dismissed) {
      setShowOnboarding(true)
    }
  }, [isNewUser])

  const handleClose = () => {
    setShowOnboarding(false)
    localStorage.setItem('eidosform_onboarding_done', '1')
  }

  return <OnboardingModal open={showOnboarding} onClose={handleClose} />
}
