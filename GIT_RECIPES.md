
## Creating a new branch

The most important things are:

1. You are on the latest main branch
2. Your main branch isn't "messed up"

To get on the latest main branch:

```
git checkout main
git pull --ff-only
```

Why `--ff-only`?  See FAQ

## Pushing a branch to github and open PR

Make sure you are on the right branch:

```
git checkout your_branch_name
```

Then push it up to github:

```
git push -u origin your_branch_name
```

## Pulling latest main

```
git checkout main
git pull --ff-only
```

Why `--ff-only`?  See FAQ

## Committing and pushing directly to main

Avoid this.  Let's use branches and PRs

## Merging latest main into your branch

Why would you want to do this?  Basically if you know that the main branch has had a lot of changes since you branched off main, and you want to have those changes, you should merge the latest remote main into your branch.

Here's how to do it.

First commit all of your current changes to your branch:

```
git add .
git commit -m "..."
```

Then switch to main and pull the latest:

```
git checkout main
git pull --ff-only
```

Then switch back to your branch:

```
git checkout your_branch
```

Now merge main into your branch:

```
git merge main
```

This *will* create a merge commit, and your history might no longer be a linear history, but it's ok.  When the PR is merged to main, it will be squashed into a single commit, and it will have a linear history.

If you have merge conflicts, call tech support to do a screenshare.

## Handling multiple outstanding branches (unstacked)

As long as your branches don't depend on each other, it's fine to juggle a few branches at the same time.

Here's how to do it:

First pull the latest main

```
git checkout main
git pull --ff-only
```

Create your first branch:

```
git checkout -b branch_1
```

Make changes on this branch, push to github, open a PR, etc.  

Ideally just get the first branch reviewed and merged to main at this point, and then create the 2nd branch off of main (much simpler).  But if that's not feasible, and you need a 2nd branch/PR, you can do the following:


Pull the latest main again, since it may have changed

```
git checkout main
git pull --ff-only
```

Create your second branch:

```
git checkout -b branch_2
```

Make changes on this branch, push to github, open a PR, etc.  


## Handling multiple outstanding branches (stacked)

If your branches depend on each other, you would need to use stacked branches.

Call tech support before stacking PR branches.  We'll probably never need to do this.


## FAQ

### Why `--ff-only`?  

It prevents merging the remote main into your local main in a way that creates a merge commit, which should never happen because main needs a linear history (no merge commits).

Why would pulling main create a merge commit?  See other FAQ below.

### Why would pulling main create a merge commit?  

It can easily happen in this scenario:

1. You want to change something
2. You forget to make a branch
3. You commit directly to remote main 
4. Someone else pushes changes to main, now your main has diverged from the remote main
5. You do a git pull, without passing `--rebase`
6. Git will see the divergence and merge remote main into your main, creating a merge commit
7. You try to git push, but it rejects your push because the repo only allows a linear history on main

### Why is having a linear history important?

It just makes it a lot easier to reason about the change history, and it makes things very easy to undo when needed.  Avoid "commit spaghetti".

### What is a merge commit?

See chatgpt

### What is a merge conflict?

See chatgpt
