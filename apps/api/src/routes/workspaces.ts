import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import { createRequireAuthentication } from "../auth/middleware.js";
import type { AuthService } from "../auth/service.js";
import { workspaceRoles } from "../workspaces/repository.js";
import {
  LastOwnerError,
  MemberAlreadyExistsError,
  MemberNotFoundError,
  UserNotFoundError,
  WorkspaceManagementForbiddenError,
  WorkspaceNotFoundError,
  type WorkspaceService
} from "../workspaces/service.js";

const workspaceBodySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((name) => !/[\u0000-\u001f\u007f]/.test(name))
  })
  .strict();
const workspaceParamsSchema = z.object({ id: z.string().uuid() }).strict();
const memberParamsSchema = z
  .object({ id: z.string().uuid(), userId: z.string().uuid() })
  .strict();
const roleSchema = z.enum(workspaceRoles);
const addMemberBodySchema = z.union([
  z
    .object({
      email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
      role: roleSchema
    })
    .strict(),
  z.object({ role: roleSchema, userId: z.string().uuid() }).strict()
]);
const updateMemberBodySchema = z.object({ role: roleSchema }).strict();

interface WorkspaceRouteOptions {
  authService: AuthService;
  workspaceService: WorkspaceService;
}

function validationFailure(reply: FastifyReply) {
  return reply.code(400).send({
    error: { code: "validation_failed", message: "The request is invalid." }
  });
}

function workspaceFailure(reply: FastifyReply, error: unknown) {
  if (error instanceof WorkspaceNotFoundError) {
    return reply.code(404).send({
      error: { code: "workspace_not_found", message: "Workspace not found." }
    });
  }
  if (error instanceof WorkspaceManagementForbiddenError) {
    return reply.code(403).send({
      error: {
        code: "workspace_management_forbidden",
        message: "Only workspace owners can manage members."
      }
    });
  }
  if (error instanceof UserNotFoundError) {
    return reply.code(404).send({
      error: { code: "user_not_found", message: "No existing user matches that reference." }
    });
  }
  if (error instanceof MemberAlreadyExistsError) {
    return reply.code(409).send({
      error: { code: "member_already_exists", message: "The user is already a member." }
    });
  }
  if (error instanceof MemberNotFoundError) {
    return reply.code(404).send({
      error: { code: "member_not_found", message: "Workspace member not found." }
    });
  }
  if (error instanceof LastOwnerError) {
    return reply.code(409).send({
      error: {
        code: "last_owner_required",
        message: "The last owner cannot be removed or assigned a different role."
      }
    });
  }
  throw error;
}

export function registerWorkspaceRoutes(app: FastifyInstance, options: WorkspaceRouteOptions): void {
  const { authService, workspaceService } = options;
  const requireAuthentication = createRequireAuthentication(authService);

  app.post<{ Body: unknown }>(
    "/api/workspaces",
    { preHandler: requireAuthentication },
    async (request, reply) => {
      const body = workspaceBodySchema.safeParse(request.body);
      if (!body.success) {
        return validationFailure(reply);
      }
      const workspace = await workspaceService.createWorkspace(
        request.authenticatedUser!.id,
        body.data.name
      );
      return reply.code(201).send({ workspace });
    }
  );

  app.get(
    "/api/workspaces",
    { preHandler: requireAuthentication },
    async (request) => ({
      workspaces: await workspaceService.listWorkspaces(request.authenticatedUser!.id)
    })
  );

  app.get<{ Params: unknown }>(
    "/api/workspaces/:id",
    { preHandler: requireAuthentication },
    async (request, reply) => {
      const params = workspaceParamsSchema.safeParse(request.params);
      if (!params.success) {
        return validationFailure(reply);
      }
      try {
        return {
          workspace: await workspaceService.getWorkspace(
            params.data.id,
            request.authenticatedUser!.id
          )
        };
      } catch (error) {
        return workspaceFailure(reply, error);
      }
    }
  );

  app.get<{ Params: unknown }>(
    "/api/workspaces/:id/members",
    { preHandler: requireAuthentication },
    async (request, reply) => {
      const params = workspaceParamsSchema.safeParse(request.params);
      if (!params.success) {
        return validationFailure(reply);
      }
      try {
        return {
          members: await workspaceService.listMembers(
            params.data.id,
            request.authenticatedUser!.id
          )
        };
      } catch (error) {
        return workspaceFailure(reply, error);
      }
    }
  );

  app.post<{ Body: unknown; Params: unknown }>(
    "/api/workspaces/:id/members",
    { preHandler: requireAuthentication },
    async (request, reply) => {
      const params = workspaceParamsSchema.safeParse(request.params);
      const body = addMemberBodySchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return validationFailure(reply);
      }
      try {
        const reference =
          "email" in body.data ? { email: body.data.email } : { userId: body.data.userId };
        const member = await workspaceService.addMember(
          params.data.id,
          request.authenticatedUser!.id,
          reference,
          body.data.role
        );
        return reply.code(201).send({ member });
      } catch (error) {
        return workspaceFailure(reply, error);
      }
    }
  );

  app.patch<{ Body: unknown; Params: unknown }>(
    "/api/workspaces/:id/members/:userId",
    { preHandler: requireAuthentication },
    async (request, reply) => {
      const params = memberParamsSchema.safeParse(request.params);
      const body = updateMemberBodySchema.safeParse(request.body);
      if (!params.success || !body.success) {
        return validationFailure(reply);
      }
      try {
        return {
          member: await workspaceService.updateMemberRole(
            params.data.id,
            request.authenticatedUser!.id,
            params.data.userId,
            body.data.role
          )
        };
      } catch (error) {
        return workspaceFailure(reply, error);
      }
    }
  );

  app.delete<{ Params: unknown }>(
    "/api/workspaces/:id/members/:userId",
    { preHandler: requireAuthentication },
    async (request, reply) => {
      const params = memberParamsSchema.safeParse(request.params);
      if (!params.success) {
        return validationFailure(reply);
      }
      try {
        await workspaceService.removeMember(
          params.data.id,
          request.authenticatedUser!.id,
          params.data.userId
        );
        return reply.code(204).send();
      } catch (error) {
        return workspaceFailure(reply, error);
      }
    }
  );
}
