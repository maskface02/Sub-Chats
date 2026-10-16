"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { useSearchParams } from "next/navigation";
import { signInAction } from "@/lib/api-client/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { AuthActionResult } from "@/lib/api-client/types";

const INITIAL: AuthActionResult = { ok: true };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full" aria-busy={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

export default function SignInPage() {
  const [state, action] = useActionState(signInAction, INITIAL);
  const searchParams = useSearchParams();
  const requestedCallback = searchParams.get("callbackUrl");
  const callbackUrl =
    requestedCallback && requestedCallback.startsWith("/")
      ? requestedCallback
      : "/";

  const fieldErrors =
    "fieldErrors" in state && state.fieldErrors ? state.fieldErrors : {};
  const formError = "formError" in state ? state.formError : undefined;

  return (
    <Card className="border-border/60">
      <CardHeader>
        <div className="mb-2 grid h-10 w-10 place-items-center rounded-2xl bg-primary/10 text-lg">👋</div>
        <CardTitle className="text-2xl tracking-[-0.03em]">Welcome back</CardTitle>
        <CardDescription>
          Sign in to continue exploring your conversations.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="space-y-4" noValidate>
          <input type="hidden" name="callbackUrl" value={callbackUrl} />
          {formError ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {formError}
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? "email-err" : undefined}
            />
            {fieldErrors.email ? (
              <p id="email-err" className="text-xs text-destructive">
                {fieldErrors.email}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={
                fieldErrors.password ? "password-err" : undefined
              }
            />
            {fieldErrors.password ? (
              <p id="password-err" className="text-xs text-destructive">
                {fieldErrors.password}
              </p>
            ) : null}
          </div>
          <SubmitButton />
          <p className="text-center text-sm text-muted-foreground">
            New here?{" "}
            <Link
              href={
                callbackUrl !== "/"
                  ? `/signup?callbackUrl=${encodeURIComponent(callbackUrl)}`
                  : "/signup"
              }
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              Create an account
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
