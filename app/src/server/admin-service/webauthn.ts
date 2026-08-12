import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type Base64URLString,
  type CredentialDeviceType,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  type WebAuthnCredential
} from "@simplewebauthn/server";

import { ReviewRealError } from "../review-real/error.ts";
import type { StoredPasskeyCredential } from "./storage.ts";

export const SIMPLEWEBAUTHN_SERVER_VERSION = "13.3.2" as const;

export type RegistrationVerification = Readonly<{
  verified: true;
  credential: Readonly<{
    id: string;
    publicKey: Uint8Array;
    counter: number;
    transports: readonly AuthenticatorTransportFuture[];
    deviceType: CredentialDeviceType;
    backedUp: boolean;
  }>;
}>;

export type AuthenticationVerification = Readonly<{
  verified: true;
  credentialId: string;
  newCounter: number;
  credentialDeviceType: CredentialDeviceType;
  credentialBackedUp: boolean;
}>;

export interface AdminWebAuthnAdapter {
  registrationOptions(input: Readonly<{
    rpName: string;
    rpId: string;
    operatorRef: string;
    userId: Uint8Array;
    excludeCredentials: readonly StoredPasskeyCredential[];
  }>): Promise<PublicKeyCredentialCreationOptionsJSON>;
  verifyRegistration(input: Readonly<{
    response: unknown;
    expectedChallenge: string;
    expectedOrigin: string;
    expectedRpId: string;
  }>): Promise<RegistrationVerification>;
  authenticationOptions(input: Readonly<{
    rpId: string;
    credentials: readonly StoredPasskeyCredential[];
  }>): Promise<PublicKeyCredentialRequestOptionsJSON>;
  verifyAuthentication(input: Readonly<{
    response: unknown;
    expectedChallenge: string;
    expectedOrigin: string;
    expectedRpId: string;
    credential: StoredPasskeyCredential;
  }>): Promise<AuthenticationVerification>;
}

function toWebAuthnCredential(credential: StoredPasskeyCredential): WebAuthnCredential {
  return {
    id: credential.id as Base64URLString,
    publicKey: Buffer.from(credential.publicKey, "base64url"),
    counter: credential.counter,
    transports: [...credential.transports]
  };
}

export class SimpleWebAuthnAdapter implements AdminWebAuthnAdapter {
  registrationOptions(input: Readonly<{
    rpName: string;
    rpId: string;
    operatorRef: string;
    userId: Uint8Array;
    excludeCredentials: readonly StoredPasskeyCredential[];
  }>): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const userId = new Uint8Array(new ArrayBuffer(input.userId.byteLength));
    userId.set(input.userId);
    return generateRegistrationOptions({
      rpName: input.rpName,
      rpID: input.rpId,
      userName: input.operatorRef,
      userDisplayName: input.operatorRef,
      userID: userId,
      timeout: 120_000,
      attestationType: "none",
      excludeCredentials: input.excludeCredentials.map((credential) => ({
        id: credential.id as Base64URLString,
        transports: [...credential.transports]
      })),
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required"
      },
      supportedAlgorithmIDs: [-7, -257]
    });
  }

  async verifyRegistration(input: Readonly<{
    response: unknown;
    expectedChallenge: string;
    expectedOrigin: string;
    expectedRpId: string;
  }>): Promise<RegistrationVerification> {
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: input.response as RegistrationResponseJSON,
        expectedChallenge: input.expectedChallenge,
        expectedOrigin: input.expectedOrigin,
        expectedRPID: input.expectedRpId,
        requireUserPresence: true,
        requireUserVerification: true,
        supportedAlgorithmIDs: [-7, -257]
      });
    } catch {
      throw new ReviewRealError("ADMIN_REQUEST_INVALID", 401);
    }
    if (!verification.verified || !verification.registrationInfo.userVerified) {
      throw new ReviewRealError("ADMIN_REQUEST_INVALID", 401);
    }
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    return {
      verified: true,
      credential: {
        id: credential.id,
        publicKey: credential.publicKey,
        counter: credential.counter,
        transports: credential.transports ?? [],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp
      }
    };
  }

  authenticationOptions(input: Readonly<{
    rpId: string;
    credentials: readonly StoredPasskeyCredential[];
  }>): Promise<PublicKeyCredentialRequestOptionsJSON> {
    return generateAuthenticationOptions({
      rpID: input.rpId,
      timeout: 120_000,
      userVerification: "required",
      allowCredentials: input.credentials.map((credential) => ({
        id: credential.id as Base64URLString,
        transports: [...credential.transports]
      }))
    });
  }

  async verifyAuthentication(input: Readonly<{
    response: unknown;
    expectedChallenge: string;
    expectedOrigin: string;
    expectedRpId: string;
    credential: StoredPasskeyCredential;
  }>): Promise<AuthenticationVerification> {
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: input.response as AuthenticationResponseJSON,
        expectedChallenge: input.expectedChallenge,
        expectedOrigin: input.expectedOrigin,
        expectedRPID: input.expectedRpId,
        credential: toWebAuthnCredential(input.credential),
        requireUserVerification: true
      });
    } catch {
      throw new ReviewRealError("ADMIN_SESSION_REQUIRED", 401);
    }
    if (!verification.verified || !verification.authenticationInfo.userVerified) {
      throw new ReviewRealError("ADMIN_SESSION_REQUIRED", 401);
    }
    return {
      verified: true,
      credentialId: verification.authenticationInfo.credentialID,
      newCounter: verification.authenticationInfo.newCounter,
      credentialDeviceType: verification.authenticationInfo.credentialDeviceType,
      credentialBackedUp: verification.authenticationInfo.credentialBackedUp
    };
  }
}
