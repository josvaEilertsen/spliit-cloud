import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useOnlineStatus } from '@/lib/use-online-status'

import { AnonymousSignupDialog } from './anonymous-signup-dialog'
import { AuthCard } from './auth-card'
import { PasswordForm } from './password-form'
import { SocialButtons } from './social-buttons'
import { getErrorMessage, useAuthPanel } from './use-auth-panel'

export function AuthPanel({
  redirectTo,
  embedded = false,
}: {
  redirectTo?: string
  embedded?: boolean
} = {}) {
  const { t } = useTranslation(undefined, { keyPrefix: 'Auth' })
  const isOnline = useOnlineStatus()
  const [anonymousDialogOpen, setAnonymousDialogOpen] = useState(false)
  const {
    mode,
    email,
    password,
    confirmPassword,
    canSubmitPassword,
    canSignUp,
    hasEmailInvitation,
    googleEnabled,
    githubEnabled,
    twitterEnabled,
    oidcProviders,
    anonymousEnabled,
    setEmail,
    setPassword,
    setConfirmPassword,
    switchMode,
    handlePasswordSubmit,
    handleGoogle,
    handleGithub,
    handleTwitter,
    handleOidc,
    emailAuth,
  } = useAuthPanel({ redirectTo })

  const content = (
    <div className="flex flex-col gap-5">
      <SocialButtons
        googleEnabled={googleEnabled}
        githubEnabled={githubEnabled}
        twitterEnabled={twitterEnabled}
        oidcProviders={oidcProviders}
        disabled={!isOnline || emailAuth.isPending}
        onGoogle={handleGoogle}
        onGithub={handleGithub}
        onTwitter={handleTwitter}
        onOidc={handleOidc}
        onAnonymous={() => setAnonymousDialogOpen(true)}
      />

      <div className="flex items-center gap-3 text-xs text-muted-foreground uppercase">
        <div className="h-px flex-1 bg-border" />
        <span>{t('orContinueWithEmail')}</span>
        <div className="h-px flex-1 bg-border" />
      </div>

      <section className="rounded-lg bg-muted/20 p-3">
        <PasswordForm
          mode={mode}
          email={email}
          password={password}
          confirmPassword={confirmPassword}
          canSubmit={canSubmitPassword}
          error={emailAuth.isError ? getErrorMessage(emailAuth.error) : null}
          isPending={emailAuth.isPending}
          disabled={!isOnline}
          onEmailChange={setEmail}
          onPasswordChange={setPassword}
          onConfirmPasswordChange={setConfirmPassword}
          onSubmit={handlePasswordSubmit}
        />
      </section>

      {canSignUp ? (
        <div className="w-full text-center text-sm text-muted-foreground">
          {mode === 'sign-in' ? t('noAccount') : t('haveAccount')}{' '}
          <Button
            type="button"
            variant="link"
            className="h-auto px-0 py-0"
            onClick={() =>
              switchMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')
            }
          >
            {mode === 'sign-in' ? t('createAccount') : t('signIn')}
          </Button>
        </div>
      ) : (
        <p className="text-center text-sm text-muted-foreground">
          {t('inviteOnly.message')}
        </p>
      )}

      {hasEmailInvitation && mode === 'sign-up' && (
        <p className="text-center text-sm text-muted-foreground">
          {t('inviteOnly.useInvitedEmail')}
        </p>
      )}

      <p className="text-center text-xs leading-5 text-muted-foreground">
        <Trans
          i18nKey="Auth.legalNotice"
          components={{
            terms: <Link to="/terms" className="underline" />,
            privacy: <Link to="/privacy" className="underline" />,
          }}
        />
      </p>
    </div>
  )

  const panel = embedded ? (
    <div data-auth-panel="">{content}</div>
  ) : (
    <AuthCard mode={mode}>{content}</AuthCard>
  )

  return (
    <>
      {panel}
      <AnonymousSignupDialog
        open={anonymousDialogOpen}
        onOpenChange={setAnonymousDialogOpen}
        creationEnabled={anonymousEnabled}
      />
    </>
  )
}
