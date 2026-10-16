"""Project visibility: a member sees the projects they are assigned to, or every project when
their role has `projects.access_all`."""

import uuid

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from dockwell_api.deps import WorkspaceContext
from dockwell_api.models import Project, ProjectMember
from dockwell_api.permissions import Perm


async def accessible_project_ids(ctx: WorkspaceContext, db: AsyncSession) -> set[uuid.UUID]:
    if ctx.actor.has(Perm.PROJECTS_ACCESS_ALL):
        rows = await db.execute(select(Project.id).where(Project.workspace_id == ctx.workspace.id))
    else:
        rows = await db.execute(
            select(Project.id)
            .join(ProjectMember, ProjectMember.project_id == Project.id)
            .where(Project.workspace_id == ctx.workspace.id, ProjectMember.user_id == ctx.user.id)
        )
    return set(rows.scalars().all())


async def can_access_project(
    ctx: WorkspaceContext, db: AsyncSession, project_id: uuid.UUID
) -> bool:
    if ctx.actor.has(Perm.PROJECTS_ACCESS_ALL):
        return True
    return await db.get(ProjectMember, (project_id, ctx.user.id)) is not None


async def get_project(
    ctx: WorkspaceContext,
    db: AsyncSession,
    project_id: uuid.UUID,
    *,
    writable: bool = False,
    lock: bool = False,
) -> Project:
    """Load a project the acting user may see, or 404. `writable` rejects archived projects."""
    stmt = select(Project).where(Project.id == project_id, Project.workspace_id == ctx.workspace.id)
    if lock:
        stmt = stmt.with_for_update()
    project = (await db.execute(stmt)).scalar_one_or_none()
    if project is None or not await can_access_project(ctx, db, project.id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found.")
    if writable and project.archived_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This project is archived.")
    return project
