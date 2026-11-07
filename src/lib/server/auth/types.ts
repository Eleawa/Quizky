export interface PublicTeacher {
	id: string;
	email: string;
	displayName: string;
	createdAt: Date;
}

export interface PasswordHasher {
	hash(identity: string, password: string): Promise<string>;
	verify(identity: string, password: string, hash: string): Promise<boolean>;
}

export interface AuthResult {
	teacher: PublicTeacher;
	token: string;
	expiresAt: Date;
}
