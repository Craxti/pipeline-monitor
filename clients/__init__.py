"""CI service client adapters."""

from .gitlab_client import GitLabClient
from .jenkins_client import JenkinsClient

__all__ = ["JenkinsClient", "GitLabClient"]
